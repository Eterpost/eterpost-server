import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { AddressInfo } from 'node:net';
import { Server } from 'node:http';
import { createFakeLogger, getTestingRedisConnectionPool, redisSkip } from './testing-utils';
import { RedisConnectionPool } from '../src/RedisConnectionPool';
import { RedisMailingRepository } from '../src/RedisMailingRepository';
import { RedisAddressStatsRepository } from '../src/RedisAddressStatsRepository';
import { RedisSubscriptionRequestRepository } from '../src/RedisSubscriptionRequestRepository';
import { ApiKeyRepository } from '../src/ApiKeyRepository';
import { SpaceRepository } from '../src/SpaceRepository';
import { FailureCounter } from '../src/FailureCounter';
import { ReceiverListFilter } from '../src/ReceiverListFilter';
import { createExpressServer } from '../src/createExpressServer';
import { setupRoutes } from '../src/routes';


const email = 'ivan@example.com';

describe('POST /mailings/unsubscribe', { skip: redisSkip }, () => {
  let pool: RedisConnectionPool;
  let mailingRepository: RedisMailingRepository;
  let server: Server;
  let base: string;
  let salesKey: string;
  let sysKey: string;
  let frontKey: string;
  let legacyKey: string;
  let salesId: number;
  let newsId: number;

  before(async () => {
    pool = await getTestingRedisConnectionPool();
    mailingRepository = new RedisMailingRepository(pool);
    const statsRepository = new RedisAddressStatsRepository(pool);
    const apiKeyRepository = new ApiKeyRepository(pool);
    salesKey = (await apiKeyRepository.add('sales-key', { space: 'sales' }))!;
    sysKey = (await apiKeyRepository.add('sys-key', { system: true }))!;
    frontKey = (await apiKeyRepository.add('front', { proxy: true }))!;
    legacyKey = (await apiKeyRepository.add('old-key'))!;
    const spaces = new SpaceRepository(pool);
    await spaces.add({ name: 'sales' });
    await spaces.add({ name: 'news' });

    const config = {
      server: { auth: { required: true }, mail: { listIdDomain: 'example.com' }, subscription: {} }
    };
    const app = createExpressServer(config);
    const stub: any = {};
    setupRoutes(
      config, app, mailingRepository, stub, createFakeLogger(), stub,
      new FailureCounter(mailingRepository, statsRepository),
      new RedisSubscriptionRequestRepository(pool, 60), stub, stub,
      new ReceiverListFilter(statsRepository), stub, apiKeyRepository, statsRepository,
      spaces, []
    );
    server = app.listen(0);
    await new Promise(resolve => server.once('listening', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  after(async () => {
    server.close();
    await pool.close();
  });

  beforeEach(async () => {
    for (const mailing of await mailingRepository.getAll()) {
      await mailingRepository.remove(mailing);
    }
    const create = async (space: string) => (await mailingRepository.create({
      html: '<p>Test</p>', name: space, space, subject: 'test', undeliveredCount: 0
    }, [{ email }] as any)).id;
    salesId = await create('sales');
    newsId = await create('news');
  });

  async function unsubscribe (key: string, body: object) {
    const response = await fetch(`${base}/mailings/unsubscribe`, {
      body: JSON.stringify({ email, listUnsubscribe: true, ...body }),
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      method: 'POST'
    });
    return { body: await response.json() as any, status: response.status };
  }

  async function has (id: number) {
    return Boolean(await (await mailingRepository.getById(id))!.getReceiverByEmail(email));
  }

  it('should remove the address only from the space of the given mailing', async () => {
    const { body, status } = await unsubscribe(sysKey, { mailingId: salesId });
    assert.equal(status, 200);
    assert.equal(body.data.removed, 1);
    assert.equal(await has(salesId), false);
    assert.equal(await has(newsId), true);
  });

  it('should remove the address from all spaces without mailingId', async () => {
    const { body } = await unsubscribe(sysKey, {});
    assert.equal(body.data.removed, 2);
    assert.equal(await has(newsId), false);
  });

  it('should remove the address from all spaces for an unknown mailing', async () => {
    const { body } = await unsubscribe(sysKey, { mailingId: 99999 });
    assert.equal(body.data.removed, 2);
  });

  it('should let a legacy key without a role unsubscribe', async () => {
    const { body, status } = await unsubscribe(legacyKey, { mailingId: salesId });
    assert.equal(status, 200);
    assert.equal(body.data.removed, 1);
    assert.equal(await has(salesId), false);
    assert.equal(await has(newsId), true);
  });

  it('should reject a space key and a proxy key', async () => {
    for (const key of [salesKey, frontKey]) {
      const { body, status } = await unsubscribe(key, { mailingId: salesId });
      assert.equal(status, 403);
      assert.equal(body.code, 'FORBIDDEN');
      assert.equal(body.error, 'Only a system key may unsubscribe from all mailings');
    }
    assert.equal(await has(salesId), true);
  });

  it('should reject an invalid mailingId', async () => {
    for (const mailingId of [0, 1.5, '1']) {
      assert.equal((await unsubscribe(sysKey, { mailingId })).status, 400);
    }
  });
});
