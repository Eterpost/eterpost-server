import { createHash, randomBytes } from 'node:crypto';
import { RedisConnectionPool } from './RedisConnectionPool';


export interface ApiKeyRepositoryConfig {
  // имя ключа -> JSON с описанием (ApiKeyRecord без имени и lastUsedAt)
  apiKeysKey: string;
  // sha256 ключа -> имя ключа
  apiKeyHashesKey: string;
  // имя ключа -> время последнего использования (ISO)
  apiKeysLastUsedKey: string;
}

const defaultConfig: ApiKeyRepositoryConfig = {
  apiKeyHashesKey: 'API_KEY_HASHES',
  apiKeysKey: 'API_KEYS',
  apiKeysLastUsedKey: 'API_KEYS_LAST_USED'
};

export interface ApiKeyRecord {
  createdAt: string;
  hash: string;
  lastUsedAt?: string;
  name: string;
  /**
   * Ключ обратного прокси (фронта): только с ним сервер верит заголовку
   * X-Remote-User — имени пользователя, вошедшего на фронте
   */
  proxy: boolean;
  /** Ключ привязан к пространству рассылок */
  space?: string;
  /** Системный ключ: доступ ко всем пространствам и управление ими */
  system?: boolean;
}

/**
 * Роль ключа; роли взаимоисключающие. Пустая роль — «старый» ключ (legacy)
 */
export interface ApiKeyRole {
  proxy?: boolean;
  space?: string;
  system?: boolean;
}

function assertSingleRole (role: ApiKeyRole): void {
  if ([role.proxy, role.space, role.system].filter(Boolean).length > 1) {
    throw new Error('Choose one role');
  }
}

// Только роли, которые заданы: у legacy-записей новых полей нет
function roleFields (role: ApiKeyRole): { proxy: boolean; space?: string; system?: boolean } {
  return {
    proxy: Boolean(role.proxy),
    ...role.space ? { space: role.space } : {},
    ...role.system ? { system: true } : {}
  };
}

/**
 * Ключ без роли, выданный до появления пространств
 */
export function isLegacyKey (record: Pick<ApiKeyRecord, 'proxy' | 'space' | 'system'>): boolean {
  return !record.proxy && !record.space && !record.system;
}

// Имя попадает в журнал и в командную строку, поэтому без пробелов и спецсимволов
export const API_KEY_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

export function hashApiKey (key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

/**
 * Ключи доступа к API. Сам ключ не хранится — только sha256: показать его
 * можно один раз, при создании
 */
export class ApiKeyRepository {
  private readonly config: ApiKeyRepositoryConfig;

  constructor (
    private readonly redisConnectionPool: RedisConnectionPool,
    config: Partial<ApiKeyRepositoryConfig> = {}
  ) {
    this.config = { ...defaultConfig, ...config };
  }

  /**
   * Создаёт ключ и возвращает его; null, если ключ с таким именем уже есть
   */
  async add (name: string, role: ApiKeyRole = {}): Promise<string | null> {
    assertSingleRole(role);
    if (!API_KEY_NAME_PATTERN.test(name)) {
      throw new Error(`Invalid key name "${name}": use letters, digits, ".", "_", "-"`);
    }
    const key = 'ep_' + randomBytes(32).toString('base64url');
    const hash = hashApiKey(key);
    const record = { createdAt: new Date().toISOString(), hash, ...roleFields(role) };
    return this.redisConnectionPool.runWithConnection(async client => {
      const created = await client.hSetNX(this.config.apiKeysKey, name, JSON.stringify(record));
      if (!created) {
        return null;
      }
      await client.hSet(this.config.apiKeyHashesKey, hash, name);
      return key;
    });
  }

  /**
   * Меняет роль существующего ключа, сам ключ остаётся прежним;
   * false, если ключа с таким именем нет
   */
  async setRole (name: string, role: ApiKeyRole): Promise<boolean> {
    assertSingleRole(role);
    return this.redisConnectionPool.runWithConnection(async client => {
      const json = await client.hGet(this.config.apiKeysKey, name);
      if (!json) {
        return false;
      }
      const { createdAt, hash } = JSON.parse(json);
      const record = { createdAt, hash, ...roleFields(role) };
      await client.hSet(this.config.apiKeysKey, name, JSON.stringify(record));
      return true;
    });
  }

  async findByKey (key: string): Promise<ApiKeyRecord | null> {
    const hash = hashApiKey(key);
    return this.redisConnectionPool.runWithConnection(async client => {
      const name = await client.hGet(this.config.apiKeyHashesKey, hash);
      if (!name) {
        return null;
      }
      const json = await client.hGet(this.config.apiKeysKey, name);
      if (!json) {
        return null;
      }
      const record = { ...JSON.parse(json), name };
      // Индекс мог остаться от отозванного и заново созданного ключа с тем же именем
      return record.hash === hash ? record : null;
    });
  }

  async list (): Promise<ApiKeyRecord[]> {
    return this.redisConnectionPool.runWithConnection(async client => {
      const records = await client.hGetAll(this.config.apiKeysKey);
      const lastUsed = await client.hGetAll(this.config.apiKeysLastUsedKey);
      return Object.entries(records)
        .map(([name, json]) => ({ ...JSON.parse(json), lastUsedAt: lastUsed[name], name }))
        .sort((a, b) => a.name.localeCompare(b.name));
    });
  }

  /**
   * Отзывает ключ; false, если ключа с таким именем нет
   */
  async revoke (name: string): Promise<boolean> {
    return this.redisConnectionPool.runWithConnection(async client => {
      const json = await client.hGet(this.config.apiKeysKey, name);
      if (!json) {
        return false;
      }
      const { hash } = JSON.parse(json);
      await client.multi()
        .hDel(this.config.apiKeysKey, name)
        .hDel(this.config.apiKeyHashesKey, hash)
        .hDel(this.config.apiKeysLastUsedKey, name)
        .exec();
      return true;
    });
  }

  async touch (name: string, date = new Date()): Promise<void> {
    await this.redisConnectionPool.runWithConnection(async client => {
      await client.hSet(this.config.apiKeysLastUsedKey, name, date.toISOString());
    });
  }
}
