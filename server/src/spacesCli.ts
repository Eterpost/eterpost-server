import { parseArgs } from 'node:util';
import { readConfig } from './readConfig';
import { RedisConnectionPoolImpl } from './RedisConnectionPool';
import { RedisMailingRepository } from './RedisMailingRepository';
import { SPACE_NAME_PATTERN, SpaceRepository } from './SpaceRepository';


const usage = `Управление пространствами рассылок mail-server (хранятся в Redis из конфига сервера)

  spaces add <имя> [--title …] [--from …]   создать пространство
  spaces set <имя> [--title …] [--from …]   изменить название и/или адрес отправителя
  spaces list                               имя, название, адрес отправителя, участники
  spaces members <имя>                      участники пространства
  spaces add-member <имя> <логин>           добавить участника
  spaces remove-member <имя> <логин>        убрать участника
  spaces remove <имя>                       удалить пространство без рассылок

Имя: латинские буквы в нижнем регистре, цифры и дефис, до 32 знаков.
--from — адрес отправителя по умолчанию: «Имя <адрес>».`;

async function main () {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
      from: { type: 'string' },
      help: { short: 'h', type: 'boolean' },
      title: { type: 'string' }
    }
  });
  const [command, name, login] = positionals;
  if (values.help || !command) {
    console.log(usage);
    return 0;
  }
  const needsLogin = ['add-member', 'remove-member'].includes(command);
  if (['add', 'set', 'members', 'remove'].includes(command) || needsLogin) {
    if (!name || (needsLogin && !login)) {
      console.error(`Usage: spaces ${command} <name>${needsLogin ? ' <login>' : ''}`);
      return 2;
    }
  } else if (command !== 'list') {
    console.error(`Unknown command "${command}"\n\n${usage}`);
    return 2;
  }
  if (name && ['add', 'set'].includes(command) && !SPACE_NAME_PATTERN.test(name)) {
    console.error(`Invalid space name "${name}": ${SPACE_NAME_PATTERN}`);
    return 2;
  }
  if (command === 'set' && values.title === undefined && values.from === undefined) {
    console.error('Usage: spaces set <name> [--title <title>] [--from <address>]');
    return 2;
  }

  const config = readConfig();
  const pool = new RedisConnectionPoolImpl(config.server.redis, { max: 1, min: 1 });
  try {
    const spaces = new SpaceRepository(pool, config.server.redis.prefixes);
    switch (command) {
      case 'add':
        if (!await spaces.add({ from: values.from, name, title: values.title })) {
          console.error(`Space "${name}" already exists`);
          return 1;
        }
        console.log(`Space "${name}" created`);
        return 0;
      case 'set':
        if (!await spaces.update(name, { from: values.from, title: values.title })) {
          console.error(`No space "${name}"`);
          return 1;
        }
        console.log(`Space "${name}" changed`);
        return 0;
      case 'list':
        for (const space of await spaces.list()) {
          const members = await spaces.getMembers(space.name);
          console.log([
            space.name, space.title ?? '', space.from ?? '', members.join(',')
          ].join('\t'));
        }
        return 0;
      case 'members':
        if (!await spaces.get(name)) {
          console.error(`No space "${name}"`);
          return 1;
        }
        for (const member of await spaces.getMembers(name)) {
          console.log(member);
        }
        return 0;
      case 'add-member':
        if (!await spaces.addMember(name, login)) {
          console.error(`No space "${name}"`);
          return 1;
        }
        console.log(`"${login}" is a member of "${name}"`);
        return 0;
      case 'remove-member':
        if (!await spaces.removeMember(name, login)) {
          console.error(`"${login}" is not a member of "${name}"`);
          return 1;
        }
        console.log(`"${login}" removed from "${name}"`);
        return 0;
      case 'remove': {
        const mailings = new RedisMailingRepository(pool, config.server.redis.prefixes);
        const count = (await mailings.getAll()).filter(mailing => mailing.space === name).length;
        if (count) {
          console.error(`Space "${name}" has ${count} mailing(s); it cannot be removed`);
          return 1;
        }
        if (!await spaces.remove(name)) {
          console.error(`No space "${name}"`);
          return 1;
        }
        console.log(`Space "${name}" removed`);
        return 0;
      }
    }
    return 2;
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
