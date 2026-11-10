import { parseArgs } from 'node:util';
import { readConfig } from './readConfig';
import { RedisConnectionPoolImpl } from './RedisConnectionPool';
import { ApiKeyRecord, ApiKeyRepository, ApiKeyRole, isLegacyKey } from './ApiKeyRepository';
import { SpaceRepository } from './SpaceRepository';


const usage = `Управление ключами API mail-server (хранятся в Redis из конфига сервера)

  api-keys add <имя> [роль]      создать ключ и вывести его (показывается один раз)
  api-keys set-role <имя> <роль> сменить роль существующего ключа (сам ключ не меняется)
  api-keys list                  имя, роль, дата создания, последнее использование
  api-keys revoke <имя>          отозвать ключ

Роль (не больше одной; без роли — «старый» ключ, legacy):
  --space <пространство>         ключ работает только в этом пространстве
  --system                       системный ключ: все пространства
  --proxy                        ключ фронта, которому сервер верит в заголовке
                                 X-Remote-User`;

function describeRole (record: Pick<ApiKeyRecord, 'proxy' | 'space' | 'system'>): string {
  if (record.space) {
    return `space:${record.space}`;
  }
  if (record.system) {
    return 'system';
  }
  return isLegacyKey(record) ? 'legacy' : 'proxy';
}

async function main () {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
      help: { short: 'h', type: 'boolean' },
      proxy: { type: 'boolean' },
      space: { type: 'string' },
      system: { type: 'boolean' }
    }
  });
  const [command, name] = positionals;
  if (values.help || !command) {
    console.log(usage);
    return 0;
  }
  if (['add', 'revoke', 'set-role'].includes(command) && !name) {
    console.error(`Usage: api-keys ${command} <name>`);
    return 2;
  }
  if (values.space !== undefined && !values.space.trim()) {
    console.error('Empty --space: give a space name');
    return 2;
  }
  const role: ApiKeyRole = { proxy: values.proxy, space: values.space, system: values.system };
  if (command === 'set-role' && !role.proxy && !role.space && !role.system) {
    console.error('Usage: api-keys set-role <name> --space <space> | --system | --proxy');
    return 2;
  }

  const config = readConfig();
  const pool = new RedisConnectionPoolImpl(config.server.redis, { max: 1, min: 1 });
  const repository = new ApiKeyRepository(pool, config.server.redis.prefixes);
  try {
    const spaces = new SpaceRepository(pool, config.server.redis.prefixes);
    if (role.space && !await spaces.get(role.space)) {
      console.error(`No space "${role.space}"`);
      return 1;
    }
    switch (command) {
      case 'add': {
        const key = await repository.add(name, role);
        if (!key) {
          console.error(`Key "${name}" already exists; revoke it first to issue a new one`);
          return 1;
        }
        console.log(key);
        return 0;
      }
      case 'set-role':
        if (!await repository.setRole(name, role)) {
          console.error(`No key "${name}"`);
          return 1;
        }
        console.log(`Role of "${name}" changed`);
        return 0;
      case 'list': {
        for (const record of await repository.list()) {
          console.log([
            record.name, describeRole(record), record.createdAt,
            record.lastUsedAt || 'never'
          ].join('\t'));
        }
        return 0;
      }
      case 'revoke':
        if (!await repository.revoke(name)) {
          console.error(`No key "${name}"`);
          return 1;
        }
        console.log(`Revoked "${name}"`);
        return 0;
      default:
        console.error(`Unknown command "${command}"\n\n${usage}`);
        return 2;
    }
  } finally {
    await pool.close();
  }
}

main().then(code => {
  process.exitCode = code;
}, error => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
