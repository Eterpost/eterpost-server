import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getTestingRedisConnectionPool, redisSkip } from './testing-utils';
import { RedisConnectionPool } from '../src/RedisConnectionPool';
import { RedisMailingRepository } from '../src/RedisMailingRepository';
import { migrateMailingsToDefaultSpace } from '../src/migrateSpaces';


describe('migrateMailingsToDefaultSpace', { skip: redisSkip }, () => {
  let pool: RedisConnectionPool;
  let repository: RedisMailingRepository;

  before(async () => {
    pool = await getTestingRedisConnectionPool();
    repository = new RedisMailingRepository(pool);
  });

  after(async () => {
    await pool.close();
  });

  it('should add the default space only to mailings without it', async () => {
    const props = { html: '<p>x</p>', name: 'n', subject: 's', undeliveredCount: 0 };
    const withSpace = await repository.create({ ...props, space: 'sales' }, []);
    const old = await repository.create(props, [{ email: 'a@example.com' }]);
    // Рассылка старого формата: в JSON нет space, есть поля, неизвестные сериализатору
    const oldKey = 'MAILING_COMMON_DATA_' + old.id;
    await pool.runWithConnection(client => client.set(
      oldKey, JSON.stringify({ ...props, extra: 1 })
    ));
    const receiversBefore = await pool.runWithConnection(
      client => client.lRange('MAILING_RECEIVER_LIST_' + old.id, 0, -1)
    );

    assert.equal(await migrateMailingsToDefaultSpace(repository), 1);

    const raw = JSON.parse((await pool.runWithConnection(client => client.get(oldKey)))!);
    assert.equal(raw.space, 'default');
    assert.equal(raw.extra, 1);
    assert.equal((await repository.getById(withSpace.id))!.space, 'sales');
    const receiversAfter = await pool.runWithConnection(
      client => client.lRange('MAILING_RECEIVER_LIST_' + old.id, 0, -1)
    );
    assert.deepEqual(receiversAfter, receiversBefore);

    assert.equal(await migrateMailingsToDefaultSpace(repository), 0);
  });
});
