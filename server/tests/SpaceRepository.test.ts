import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { RedisConnectionPool } from '../src/RedisConnectionPool';
import { SpaceRepository } from '../src/SpaceRepository';
import { getTestingRedisConnectionPool, redisSkip } from './testing-utils';


describe('SpaceRepository', { skip: redisSkip }, () => {
  let pool: RedisConnectionPool;
  let repository: SpaceRepository;

  before(async () => {
    pool = await getTestingRedisConnectionPool();
    repository = new SpaceRepository(pool);
  });

  after(async () => {
    await pool.close();
  });

  beforeEach(async () => {
    await pool.runWithConnection(async client => {
      const keys = await client.keys('SPACE*');
      if (keys.length) {
        await client.del(keys);
      }
    });
  });

  it('should add a space only once', async () => {
    assert.equal(await repository.add({ name: 'sales' }), true);
    assert.equal(await repository.add({ name: 'sales' }), false);
  });

  it('should return title, from and createdAt', async () => {
    await repository.add({ from: 'sales@example.com', name: 'sales', title: 'Sales' });
    const space = await repository.get('sales');
    assert.equal(space?.name, 'sales');
    assert.equal(space?.title, 'Sales');
    assert.equal(space?.from, 'sales@example.com');
    assert.ok(space?.createdAt && !isNaN(Date.parse(space.createdAt)));
    assert.equal(await repository.get('missing'), null);
  });

  it('should list spaces sorted by name', async () => {
    await repository.add({ name: 'sales' });
    await repository.add({ name: 'news' });
    assert.deepEqual((await repository.list()).map(s => s.name), ['news', 'sales']);
  });

  it('should update a space', async () => {
    assert.equal(await repository.update('sales', { title: 'x' }), false);
    await repository.add({ name: 'sales', title: 'Old' });
    assert.equal(await repository.update('sales', { from: 'a@example.com' }), true);
    const space = await repository.get('sales');
    assert.equal(space?.title, 'Old');
    assert.equal(space?.from, 'a@example.com');
  });

  it('should manage members', async () => {
    assert.equal(await repository.addMember('sales', 'ivan'), false);
    await repository.add({ name: 'sales' });
    await repository.add({ name: 'news' });
    assert.equal(await repository.addMember('sales', 'ivan'), true);
    assert.equal(await repository.addMember('news', 'ivan'), true);
    await repository.addMember('sales', 'anna');
    assert.deepEqual(await repository.getMembers('sales'), ['anna', 'ivan']);
    assert.deepEqual(await repository.getSpacesOfUser('ivan'), ['news', 'sales']);
    assert.equal(await repository.removeMember('sales', 'ivan'), true);
    assert.equal(await repository.removeMember('sales', 'ivan'), false);
    assert.deepEqual(await repository.getSpacesOfUser('ivan'), ['news']);
  });

  it('should report whether any member exists', async () => {
    await repository.add({ name: 'sales' });
    assert.equal(await repository.hasAnyMembers(), false);
    await repository.addMember('sales', 'ivan');
    assert.equal(await repository.hasAnyMembers(), true);
  });

  it('should remove a space together with its members', async () => {
    await repository.add({ name: 'sales' });
    await repository.add({ name: 'news' });
    await repository.addMember('sales', 'ivan');
    await repository.addMember('news', 'ivan');
    assert.equal(await repository.remove('sales'), true);
    assert.equal(await repository.remove('sales'), false);
    assert.equal(await repository.get('sales'), null);
    assert.deepEqual(await repository.getMembers('sales'), []);
    assert.deepEqual(await repository.getSpacesOfUser('ivan'), ['news']);
  });
});
