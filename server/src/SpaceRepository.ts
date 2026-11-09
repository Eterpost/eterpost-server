import { RedisConnectionPool } from './RedisConnectionPool';


export interface SpaceRepositoryConfig {
  // префикс ключей множеств участников; полный ключ — префикс + имя пространства
  spaceMembersKeyPrefix: string;
  // имя пространства -> JSON с описанием (Space без имени)
  spacesKey: string;
}

const defaultConfig: SpaceRepositoryConfig = {
  spaceMembersKeyPrefix: 'SPACE_MEMBERS_',
  spacesKey: 'SPACES'
};

export const SPACE_NAME_PATTERN = /^[a-z0-9][a-z0-9-]{0,31}$/;

export const DEFAULT_SPACE = 'default';

export interface Space {
  createdAt: string;
  from?: string;
  name: string;
  title?: string;
}

/**
 * Пространства рассылок и их участники (логины пользователей)
 */
export class SpaceRepository {
  private readonly config: SpaceRepositoryConfig;

  constructor (
    private readonly redisConnectionPool: RedisConnectionPool,
    config: Partial<SpaceRepositoryConfig> = {}
  ) {
    this.config = { ...defaultConfig, ...config };
  }

  private membersKey (name: string): string {
    return this.config.spaceMembersKeyPrefix + name;
  }

  /**
   * Создаёт пространство; false, если оно уже есть
   */
  async add (space: Omit<Space, 'createdAt'>): Promise<boolean> {
    const { name, ...rest } = space;
    const record = { ...rest, createdAt: new Date().toISOString() };
    return this.redisConnectionPool.runWithConnection(async client =>
      Boolean(await client.hSetNX(this.config.spacesKey, name, JSON.stringify(record)))
    );
  }

  async get (name: string): Promise<Space | null> {
    return this.redisConnectionPool.runWithConnection(async client => {
      const json = await client.hGet(this.config.spacesKey, name);
      return json ? { ...JSON.parse(json), name } : null;
    });
  }

  async list (): Promise<Space[]> {
    return this.redisConnectionPool.runWithConnection(async client => {
      const records = await client.hGetAll(this.config.spacesKey);
      return Object.entries(records)
        .map(([name, json]) => ({ ...JSON.parse(json), name }))
        .sort((a, b) => a.name.localeCompare(b.name));
    });
  }

  /**
   * Меняет название и/или адрес отправителя; false, если пространства нет
   */
  async update (name: string, patch: { from?: string, title?: string }): Promise<boolean> {
    return this.redisConnectionPool.runWithConnection(async client => {
      const json = await client.hGet(this.config.spacesKey, name);
      if (!json) {
        return false;
      }
      const record = { ...JSON.parse(json) };
      if (patch.title !== undefined) {
        record.title = patch.title;
      }
      if (patch.from !== undefined) {
        record.from = patch.from;
      }
      await client.hSet(this.config.spacesKey, name, JSON.stringify(record));
      return true;
    });
  }

  /**
   * Удаляет пространство вместе с участниками; false, если его нет
   */
  async remove (name: string): Promise<boolean> {
    return this.redisConnectionPool.runWithConnection(async client => {
      const removed = await client.hDel(this.config.spacesKey, name);
      await client.del(this.membersKey(name));
      return removed > 0;
    });
  }

  /**
   * Добавляет участника; false, если пространства нет
   */
  async addMember (name: string, login: string): Promise<boolean> {
    return this.redisConnectionPool.runWithConnection(async client => {
      if (!await client.hExists(this.config.spacesKey, name)) {
        return false;
      }
      await client.sAdd(this.membersKey(name), login);
      return true;
    });
  }

  async removeMember (name: string, login: string): Promise<boolean> {
    return this.redisConnectionPool.runWithConnection(async client =>
      (await client.sRem(this.membersKey(name), login)) > 0
    );
  }

  async getMembers (name: string): Promise<string[]> {
    return this.redisConnectionPool.runWithConnection(async client =>
      (await client.sMembers(this.membersKey(name))).sort()
    );
  }

  /**
   * Имена пространств, где пользователь участник; пространств единицы,
   * поэтому перебор list() и sIsMember
   */
  async getSpacesOfUser (login: string): Promise<string[]> {
    const spaces = await this.list();
    return this.redisConnectionPool.runWithConnection(async client => {
      const result: string[] = [];
      for (const { name } of spaces) {
        if (await client.sIsMember(this.membersKey(name), login)) {
          result.push(name);
        }
      }
      return result;
    });
  }

  async hasAnyMembers (): Promise<boolean> {
    const spaces = await this.list();
    return this.redisConnectionPool.runWithConnection(async client => {
      for (const { name } of spaces) {
        if (await client.sCard(this.membersKey(name)) > 0) {
          return true;
        }
      }
      return false;
    });
  }
}
