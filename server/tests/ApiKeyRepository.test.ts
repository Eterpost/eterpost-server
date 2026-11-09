import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getTestingRedisConnectionPool, redisSkip } from './testing-utils';
import { RedisConnectionPool } from '../src/RedisConnectionPool';
import { ApiKeyRecord, ApiKeyRepository, hashApiKey, isLegacyKey } from '../src/ApiKeyRepository';


describe('ApiKeyRepository roles', { skip: redisSkip }, () => {
  let pool: RedisConnectionPool;
  let repository: ApiKeyRepository;

  before(async () => {
    pool = await getTestingRedisConnectionPool();
    repository = new ApiKeyRepository(pool);
  });

  after(async () => {
    await pool.close();
  });

  beforeEach(async () => {
    await pool.runWithConnection(client => client.flushDb());
  });

  it('should create a key bound to a space', async () => {
    const key = await repository.add('site', { space: 'sales' });
    const record = await repository.findByKey(key!);
    assert.equal(record?.space, 'sales');
    assert.equal(record?.system, undefined);
    assert.equal(record?.proxy, false);
  });

  it('should create system and proxy keys', async () => {
    const systemKey = await repository.add('admin', { system: true });
    const proxyKey = await repository.add('front', { proxy: true });
    assert.equal((await repository.findByKey(systemKey!))?.system, true);
    assert.equal((await repository.findByKey(proxyKey!))?.proxy, true);
  });

  it('should refuse more than one role', async () => {
    await assert.rejects(repository.add('x', { proxy: true, space: 'a' }), /Choose one role/);
    await assert.rejects(repository.add('x', { space: 'a', system: true }), /Choose one role/);
    await assert.rejects(repository.setRole('x', { proxy: true, system: true }), /Choose one role/);
  });

  it('should change the role of an existing key keeping the key itself', async () => {
    const key = await repository.add('old');
    assert.equal(await repository.setRole('old', { system: true }), true);
    let record = await repository.findByKey(key!);
    assert.equal(record?.system, true);
    assert.equal(record?.space, undefined);
    assert.equal(record?.proxy, false);

    assert.equal(await repository.setRole('old', { space: 'sales' }), true);
    record = await repository.findByKey(key!);
    assert.equal(record?.space, 'sales');
    assert.equal(record?.system, undefined);

    assert.equal(await repository.setRole('old', { proxy: true }), true);
    record = await repository.findByKey(key!);
    assert.equal(record?.proxy, true);
    assert.equal(record?.space, undefined);
  });

  it('should return false from setRole for an unknown key', async () => {
    assert.equal(await repository.setRole('nope', { system: true }), false);
  });

  it('should keep loading legacy records without the new fields', async () => {
    const key = 'ep_legacy-key';
    await pool.runWithConnection(async client => {
      await client.hSet('API_KEYS', 'legacy', JSON.stringify({
        createdAt: '2026-01-01T00:00:00.000Z', hash: hashApiKey(key), proxy: false
      }));
      await client.hSet('API_KEY_HASHES', hashApiKey(key), 'legacy');
    });
    const record = await repository.findByKey(key);
    assert.equal(record?.name, 'legacy');
    assert.equal(isLegacyKey(record!), true);
    assert.equal((await repository.list()).length, 1);
  });

  it('should tell legacy keys from role keys', () => {
    const base: ApiKeyRecord = { createdAt: '', hash: '', name: 'k', proxy: false };
    assert.equal(isLegacyKey(base), true);
    assert.equal(isLegacyKey({ ...base, proxy: true }), false);
    assert.equal(isLegacyKey({ ...base, space: 'a' }), false);
    assert.equal(isLegacyKey({ ...base, system: true }), false);
  });
});
