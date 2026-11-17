import { after, before, describe, it } from 'node:test';
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
  html: '<p>Test</p>', name: 'admin test', receivers: [{ email: 'ivan@example.com' }],
  subject: 'test'
};

describe('admin API', { skip: redisSkip }, () => {
  let pool: RedisConnectionPool;
  let mailingRepository: RedisMailingRepository;
  let keyRepository: ApiKeyRepository;
  let spaces: SpaceRepository;
  let server: Server;
  let base: string;
  let adminKey: string;
  let sysKey: string;
  let salesKey: string;
  let frontKey: string;
  let legacyKey: string;

  before(async () => {
    pool = await getTestingRedisConnectionPool();
    mailingRepository = new RedisMailingRepository(pool);
    const statsRepository = new RedisAddressStatsRepository(pool);
    keyRepository = new ApiKeyRepository(pool);
    spaces = new SpaceRepository(pool);
    await spaces.add({ name: 'sales', title: 'Sales' });
    await spaces.addMember('sales', 'ivan');
    adminKey = (await keyRepository.add('admin-key', { admin: true }))!;
    sysKey = (await keyRepository.add('sys-key', { system: true }))!;
    salesKey = (await keyRepository.add('sales-key', { space: 'sales' }))!;
    frontKey = (await keyRepository.add('front', { proxy: true }))!;
    legacyKey = (await keyRepository.add('old-key'))!;

    const config = {
      server: { auth: { required: true }, mail: { listIdDomain: 'example.com' }, subscription: {} }
    };
    const app = createExpressServer(config);
    const stub: any = {};
    setupRoutes(
      config, app, mailingRepository, stub, createFakeLogger(), stub,
      new FailureCounter(mailingRepository, statsRepository),
      new RedisSubscriptionRequestRepository(pool, 60), stub, stub,
      new ReceiverListFilter(statsRepository), stub, keyRepository, statsRepository,
      spaces, ['lav']
    );
    server = app.listen(0);
    await new Promise(resolve => server.once('listening', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  after(async () => {
    server.close();
    await pool.close();
  });

  const as = (user: string) => ({ 'X-Remote-User': user });

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

  function ok (result: { body: any, status: number }) {
    assert.equal(result.status, 200, JSON.stringify(result.body));
    return result.body.data;
  }

  it('should tell who is an administrator', async () => {
    assert.deepEqual(ok(await request(adminKey, 'GET', '/me')),
      { admin: true, key: 'admin-key' });
    assert.deepEqual(ok(await request(frontKey, 'GET', '/me', undefined, as('lav'))),
      { admin: true, key: 'front', user: 'lav' });
    assert.deepEqual(ok(await request(frontKey, 'GET', '/me', undefined, as('ivan'))),
      { admin: false, key: 'front', user: 'ivan' });
    assert.equal(ok(await request(sysKey, 'GET', '/me')).admin, false);
  });

  it('should let only administrators in', async () => {
    const denied: Array<[string, Record<string, string>?]> = [
      [sysKey], [salesKey], [legacyKey], [frontKey], [frontKey, { 'X-Remote-User': 'ivan' }]
    ];
    for (const [key, headers] of denied) {
      for (const [method, path] of [['GET', '/admin/spaces'], ['GET', '/admin/keys'],
        ['POST', '/admin/keys'], ['DELETE', '/admin/spaces/sales']]) {
        const body = method === 'POST' ? {} : undefined;
        const result = await request(key, method, path, body, headers);
        assert.equal(result.status, 403, `${method} ${path}`);
        assert.equal(result.body.code, 'ADMIN_REQUIRED');
      }
    }
    ok(await request(frontKey, 'GET', '/admin/keys', undefined, { 'X-Remote-User': 'lav' }));
    ok(await request(adminKey, 'GET', '/admin/keys'));
  });

  it('should see mailings of every space', async () => {
    ok(await request(salesKey, 'POST', '/mailings', mailingBody));
    ok(await request(adminKey, 'POST', '/mailings', { ...mailingBody, name: 'default one' }));
    const list = ok(await request(adminKey, 'GET', '/mailings'));
    assert.deepEqual(list.map((m: any) => m.space).sort(), ['default', 'sales']);
  });

  it('should manage spaces and members', async () => {
    ok(await request(adminKey, 'POST', '/admin/spaces', { name: 'news', title: 'News' }));
    assert.equal((await request(adminKey, 'POST', '/admin/spaces', { name: 'news' })).body.code,
      'SPACE_EXISTS');
    assert.equal((await request(adminKey, 'POST', '/admin/spaces', { name: 'Bad Name' })).status,
      400);
    ok(await request(adminKey, 'PUT', '/admin/spaces/news', { from: 'News <news@example.com>' }));
    ok(await request(adminKey, 'PUT', '/admin/spaces/news/members/petr', {}));
    assert.equal((await request(adminKey, 'PUT', '/admin/spaces/nope/members/petr', {})).status,
      404);

    const list = ok(await request(adminKey, 'GET', '/admin/spaces'));
    const news = list.find((space: any) => space.name === 'news');
    assert.deepEqual(news.members, ['petr']);
    assert.equal(news.from, 'News <news@example.com>');
    assert.equal(news.title, 'News');
    assert.ok(list.some((space: any) => space.name === 'default' && space.mailingCount === 1));
    assert.equal(list.find((space: any) => space.name === 'sales').mailingCount, 1);

    // Участник видит пространство в веб-интерфейсе
    const petr = ok(await request(frontKey, 'GET', '/spaces', undefined, as('petr')));
    assert.deepEqual(petr.map((space: any) => space.name), ['news']);

    ok(await request(adminKey, 'DELETE', '/admin/spaces/news/members/petr'));
    const again = await request(adminKey, 'DELETE', '/admin/spaces/news/members/petr');
    assert.equal(again.status, 404);
    ok(await request(adminKey, 'DELETE', '/admin/spaces/news'));
    assert.equal((await request(adminKey, 'DELETE', '/admin/spaces/news')).status, 404);
    assert.equal((await request(adminKey, 'DELETE', '/admin/spaces/default')).status, 400);
    assert.equal((await request(adminKey, 'DELETE', '/admin/spaces/sales')).body.code,
      'SPACE_NOT_EMPTY');
  });

  it('should move a mailing to another space', async () => {
    const id = ok(await request(adminKey, 'GET', '/mailings'))
      .find((m: any) => m.space === 'default').id;
    const moved = await request(adminKey, 'POST', `/admin/mailings/${id}/move`, { space: 'sales' });
    assert.deepEqual(ok(moved), { previous: 'default', space: 'sales' });
    assert.equal(ok(await request(salesKey, 'GET', `/mailings/${id}`)).space, 'sales');
    assert.equal((await request(adminKey, 'POST', `/admin/mailings/${id}/move`, { space: 'nope' }))
      .body.code, 'SPACE_NOT_FOUND');
    assert.equal((await request(adminKey, 'POST', '/admin/mailings/99999/move', { space: 'sales' }))
      .status, 404);
  });

  it('should issue keys that work at once, change roles and revoke them', async () => {
    const issued = ok(await request(adminKey, 'POST', '/admin/keys',
      { name: 'site-sales', role: { space: 'sales', type: 'space' } }));
    assert.equal(issued.name, 'site-sales');
    assert.match(issued.key, /^ep_/);
    assert.equal((await request(adminKey, 'POST', '/admin/keys',
      { name: 'site-sales', role: { type: 'system' } })).body.code, 'KEY_EXISTS');
    assert.equal((await request(adminKey, 'POST', '/admin/keys',
      { name: 'x', role: { space: 'nope', type: 'space' } })).body.code, 'SPACE_NOT_FOUND');
    assert.equal((await request(adminKey, 'POST', '/admin/keys',
      { name: 'x', role: { type: 'legacy' } })).status, 400);

    // Новый ключ сразу работает в своём пространстве
    const created = ok(await request(issued.key, 'POST', '/mailings', mailingBody));
    assert.equal(ok(await request(issued.key, 'GET', `/mailings/${created.id}`)).space, 'sales');

    const list = ok(await request(adminKey, 'GET', '/admin/keys'));
    const site = list.find((item: any) => item.name === 'site-sales');
    assert.deepEqual(site.role, { space: 'sales', type: 'space' });
    assert.equal(site.hash, undefined);
    assert.equal(list.find((item: any) => item.name === 'admin-key').current, true);
    assert.deepEqual(list.find((item: any) => item.name === 'old-key').role, { type: 'legacy' });

    ok(await request(adminKey, 'PUT', '/admin/keys/site-sales/role', { role: { type: 'admin' } }));
    assert.equal(ok(await request(issued.key, 'GET', '/me')).admin, true);
    assert.equal((await request(adminKey, 'PUT', '/admin/keys/nope/role',
      { role: { type: 'system' } })).status, 404);

    ok(await request(adminKey, 'DELETE', '/admin/keys/site-sales'));
    assert.equal((await request(issued.key, 'GET', '/me')).status, 401);
    assert.equal((await request(adminKey, 'DELETE', '/admin/keys/site-sales')).status, 404);
  });

  it('should protect the own key and proxy keys', async () => {
    assert.equal((await request(adminKey, 'DELETE', '/admin/keys/admin-key')).body.code, 'OWN_KEY');
    assert.equal((await request(adminKey, 'PUT', '/admin/keys/admin-key/role',
      { role: { type: 'system' } })).body.code, 'OWN_KEY');
    assert.equal((await request(adminKey, 'DELETE', '/admin/keys/front')).body.code, 'PROXY_KEY');
    const other = ok(await request(adminKey, 'POST', '/admin/keys',
      { name: 'front-2', role: { type: 'proxy' } }));
    assert.match(other.key, /^ep_/);
    ok(await request(adminKey, 'DELETE', '/admin/keys/front-2?force=1'));
  });
});
