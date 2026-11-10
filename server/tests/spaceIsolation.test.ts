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


const mailingBody = {
  html: '<p>Test</p>', name: 'sales mailing', receivers: [{ email: 'ivan@example.com' }],
  subject: 'test'
};

describe('mailing spaces', { skip: redisSkip }, () => {
  let pool: RedisConnectionPool;
  let mailingRepository: RedisMailingRepository;
  let server: Server;
  let base: string;
  let salesKey: string;
  let newsKey: string;
  let sysKey: string;
  let frontKey: string;

  before(async () => {
    pool = await getTestingRedisConnectionPool();
    mailingRepository = new RedisMailingRepository(pool);
    const statsRepository = new RedisAddressStatsRepository(pool);
    const apiKeyRepository = new ApiKeyRepository(pool);
    salesKey = (await apiKeyRepository.add('sales-key', { space: 'sales' }))!;
    newsKey = (await apiKeyRepository.add('news-key', { space: 'news' }))!;
    sysKey = (await apiKeyRepository.add('sys-key', { system: true }))!;
    frontKey = (await apiKeyRepository.add('front', { proxy: true }))!;
    const spaces = new SpaceRepository(pool);
    await spaces.add({ name: 'sales' });
    await spaces.add({ name: 'news' });
    await spaces.addMember('news', 'ivan');

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
  });

  async function request (
    key: string, method: string, path: string, body?: unknown,
    headers: Record<string, string> = {}
  ) {
    const response = await fetch(base + path, {
      body: body === undefined ? undefined : JSON.stringify(body),
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', ...headers },
      method
    });
    return { body: await response.json() as any, status: response.status };
  }

  async function create (key: string, body: object = mailingBody) {
    const { body: result, status } = await request(key, 'POST', '/mailings', body);
    assert.equal(status, 200, JSON.stringify(result));
    return result.data.id as number;
  }

  it('should create a mailing in the space of the key and hide it from others', async () => {
    const id = await create(salesKey);
    const own = await request(salesKey, 'GET', `/mailings/${id}`);
    assert.equal(own.status, 200);
    assert.equal(own.body.data.space, 'sales');
    assert.equal(own.body.data.test, false);

    const cases: Array<[string, string, unknown?]> = [
      ['GET', `/mailings/${id}`],
      ['PUT', `/mailings/${id}`, { name: 'stolen' }],
      ['GET', `/mailings/${id}/receivers`],
      ['GET', `/mailings/${id}/failed-receivers`],
      ['GET', `/mailings/${id}/results`],
      ['POST', `/mailings/${id}/preview`, { email: 'ivan@example.com' }],
      ['POST', `/mailings/${id}/send-test-email`, { email: 'ivan@example.com' }],
      ['POST', `/mailings/${id}/restore-excluded`, {}],
      ['POST', `/mailings/${id}/unsubscribe`, { code: 'x', email: 'ivan@example.com' }],
      ['POST', `/mailings/${id}/subscribe`, { code: 'x', email: 'ivan@example.com' }],
      ['DELETE', `/mailings/${id}/receivers/ivan@example.com`],
      ['DELETE', `/mailings/${id}`]
    ];
    for (const [method, path, body] of cases) {
      const { body: result, status } = await request(newsKey, method, path, body);
      assert.equal(status, 404, `${method} ${path}`);
      assert.equal(result.error, 'Mailing not found', `${method} ${path}`);
    }
    const kept = await mailingRepository.getById(id);
    assert.equal(kept?.name, 'sales mailing');
    assert.deepEqual((await mailingRepository.getReceivers(id)).map(r => r.email), [
      'ivan@example.com'
    ]);
  });

  it('should refuse to copy or retry a mailing of another space', async () => {
    const id = await create(salesKey);
    const copy = await request(newsKey, 'POST', '/mailings', { sourceId: id });
    assert.equal(copy.status, 404);
    const retry = await request(newsKey, 'POST', '/mailings/create-retry', { sourceId: id });
    assert.equal(retry.status, 404);
    assert.equal((await mailingRepository.getAll()).length, 1);
  });

  it('should copy into the current space and retry into the space of the source', async () => {
    const id = await create(salesKey);
    // Служебный ключ без заголовка создаёт рассылки в пространстве по умолчанию
    const copy = await request(sysKey, 'POST', '/mailings', { sourceId: id });
    assert.equal(copy.status, 200);
    assert.equal((await mailingRepository.getById(copy.body.data.id))?.space, 'default');
    const own = await request(salesKey, 'POST', '/mailings', { sourceId: id });
    assert.equal((await mailingRepository.getById(own.body.data.id))?.space, 'sales');

    const retry = await request(sysKey, 'POST', '/mailings/create-retry', { sourceId: id });
    assert.equal(retry.status, 200);
    assert.equal((await mailingRepository.getById(retry.body.data.id))?.space, 'sales');
  });

  it('should list mailings only of the current space', async () => {
    const salesId = await create(salesKey);
    const newsId = await create(newsKey, { ...mailingBody, name: 'news mailing' });

    const news = await request(newsKey, 'GET', '/mailings');
    assert.deepEqual(news.body.data.map((mailing: any) => mailing.id), [newsId]);
    assert.equal(news.body.data[0].space, 'news');
    assert.equal(news.body.data[0].test, false);

    const all = await request(sysKey, 'GET', '/mailings');
    assert.deepEqual(new Set(all.body.data.map((mailing: any) => mailing.id)), new Set([
      salesId, newsId
    ]));

    const sales = await request(sysKey, 'GET', '/mailings', undefined, {
      'X-Eterpost-Space': 'sales'
    });
    assert.deepEqual(sales.body.data.map((mailing: any) => mailing.id), [salesId]);
  });

  it('should filter mailings by kind', async () => {
    const liveId = await create(salesKey);
    const testId = await create(salesKey, { ...mailingBody, test: true });
    const ids = async (query: string) =>
      (await request(salesKey, 'GET', `/mailings${query}`)).body.data
        .map((mailing: any) => mailing.id).sort((a: number, b: number) => a - b);

    assert.deepEqual(await ids('?kind=live'), [liveId]);
    assert.deepEqual(await ids('?kind=test'), [testId]);
    assert.deepEqual(await ids('?kind=all'), [liveId, testId]);
    assert.deepEqual(await ids(''), [liveId, testId]);
    const wrong = await request(salesKey, 'GET', '/mailings?kind=x');
    assert.equal(wrong.status, 400);
    assert.equal(wrong.body.error, 'kind must be one of: live, test, all');

    const update = await request(salesKey, 'PUT', `/mailings/${testId}`, { test: false });
    assert.equal(update.status, 200);
    assert.deepEqual(await ids('?kind=live'), [liveId, testId]);
  });

  it('should give a proxy without a user no mailings', async () => {
    await create(salesKey);
    const list = await request(frontKey, 'GET', '/mailings');
    assert.equal(list.status, 200);
    assert.deepEqual(list.body.data, []);

    const created = await request(frontKey, 'POST', '/mailings', mailingBody);
    assert.equal(created.status, 403);
    assert.equal(created.body.code, 'SPACE_REQUIRED');
  });

  it('should not track letters of another space', async () => {
    const id = await create(salesKey);
    await mailingRepository.setTrackedLetter(id, 'tok', {
      email: 'ivan@example.com', links: ['https://example.com/']
    });
    const open = await request(newsKey, 'POST', '/tracking/open', { mailingId: id, token: 'tok' });
    assert.equal(open.status, 200);
    assert.equal(open.body.data.recorded, false);
    const click = await request(newsKey, 'POST', '/tracking/click', {
      link: 0, mailingId: id, token: 'tok'
    });
    assert.equal(click.status, 404);
    assert.equal((await mailingRepository.getTrackingStats(id)).opens.size, 0);

    const own = await request(sysKey, 'POST', '/tracking/click', {
      link: 0, mailingId: id, token: 'tok'
    });
    assert.equal(own.body.data.url, 'https://example.com/');
  });
});
