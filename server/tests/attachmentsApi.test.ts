import { after, before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { AddressInfo } from 'node:net';
import { Server } from 'node:http';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFakeLogger, getTestingRedisConnectionPool, redisSkip } from './testing-utils';
import { RedisConnectionPool } from '../src/RedisConnectionPool';
import { RedisMailingRepository } from '../src/RedisMailingRepository';
import { RedisAddressStatsRepository } from '../src/RedisAddressStatsRepository';
import { RedisSubscriptionRequestRepository } from '../src/RedisSubscriptionRequestRepository';
import { ApiKeyRepository } from '../src/ApiKeyRepository';
import { SpaceRepository } from '../src/SpaceRepository';
import { FailureCounter } from '../src/FailureCounter';
import { ReceiverListFilter } from '../src/ReceiverListFilter';
import { MailingState } from '../src/MailingState';
import { AttachmentStore } from '../src/AttachmentStore';
import { createExpressServer } from '../src/createExpressServer';
import { setupRoutes } from '../src/routes';
import { MailingExecutor } from '../src/MailingExecutor';


const mailingBody = {
  html: '<p>Прайс</p>', name: 'price', receivers: [{ email: 'ivan@example.com' }],
  subject: 'price'
};
const MAX_SIZE = 2000;

describe('mailing attachments API', { skip: redisSkip }, () => {
  let pool: RedisConnectionPool;
  let mailingRepository: RedisMailingRepository;
  let store: AttachmentStore;
  let dir: string;
  let servers: Server[] = [];
  let base: string;
  let noStoreBase: string;
  let salesKey: string;
  let newsKey: string;

  async function listen (withStore: boolean) {
    const statsRepository = new RedisAddressStatsRepository(pool);
    const apiKeyRepository = new ApiKeyRepository(pool);
    const config = {
      server: {
        attachments: { dir, maxSize: MAX_SIZE }, auth: { required: true },
        mail: { listIdDomain: 'example.com' }, subscription: {}
      }
    };
    const app = createExpressServer(config);
    const stub: any = {};
    const mailer = { sendEmail: async () => {} };
    const executor = new MailingExecutor(
      mailer, mailingRepository, statsRepository, new SpaceRepository(pool), createFakeLogger(),
      { server: { mail: { from: 'no-reply@example.com' } } }, withStore ? store : undefined
    );
    setupRoutes(
      config, app, mailingRepository, stub, createFakeLogger(), executor,
      new FailureCounter(mailingRepository, statsRepository),
      new RedisSubscriptionRequestRepository(pool, 60), stub, stub,
      new ReceiverListFilter(statsRepository), stub, apiKeyRepository, statsRepository,
      new SpaceRepository(pool), [], withStore ? store : undefined
    );
    const server = app.listen(0);
    servers.push(server);
    await new Promise(resolve => server.once('listening', resolve));
    return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  }

  before(async () => {
    pool = await getTestingRedisConnectionPool();
    mailingRepository = new RedisMailingRepository(pool);
    const apiKeyRepository = new ApiKeyRepository(pool);
    salesKey = (await apiKeyRepository.add('att-sales', { space: 'sales' }))!;
    newsKey = (await apiKeyRepository.add('att-news', { space: 'news' }))!;
    const spaces = new SpaceRepository(pool);
    await spaces.add({ name: 'sales' });
    await spaces.add({ name: 'news' });
    dir = await mkdtemp(join(tmpdir(), 'att-api-'));
    store = new AttachmentStore(dir);
    await store.init();
    base = await listen(true);
    noStoreBase = await listen(false);
  });

  after(async () => {
    for (const server of servers) {
      server.close();
    }
    servers = [];
    await pool.close();
    await rm(dir, { force: true, recursive: true });
  });

  beforeEach(async () => {
    for (const mailing of await mailingRepository.getAll()) {
      await mailingRepository.remove(mailing);
    }
  });

  async function request (key: string, method: string, path: string, body?: unknown) {
    const response = await fetch(base + path, {
      body: body === undefined ? undefined : JSON.stringify(body),
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      method
    });
    return { body: await response.json() as any, status: response.status };
  }

  async function upload (
    key: string, id: number, filename: string | null, content: Buffer,
    contentType = 'application/pdf', url = base
  ) {
    const query = filename === null ? '' : '?filename=' + encodeURIComponent(filename);
    const response = await fetch(`${url}/mailings/${id}/attachments${query}`, {
      body: content,
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': contentType },
      method: 'POST'
    });
    return { body: await response.json() as any, status: response.status };
  }

  async function create (key = salesKey, body: object = mailingBody) {
    const { body: result, status } = await request(key, 'POST', '/mailings', body);
    assert.equal(status, 200, JSON.stringify(result));
    return result.data.id as number;
  }

  it('should upload, list and download an attachment', async () => {
    const id = await create();
    const content = Buffer.alloc(1000, 7);
    const uploaded = await upload(salesKey, id, 'Прайс ноябрь.pdf', content);
    assert.equal(uploaded.status, 201, JSON.stringify(uploaded.body));
    const info = uploaded.body.data;
    assert.equal(info.filename, 'Прайс ноябрь.pdf');
    assert.equal(info.contentType, 'application/pdf');
    assert.equal(info.size, 1000);

    const mailing = await request(salesKey, 'GET', `/mailings/${id}`);
    assert.deepEqual(mailing.body.data.attachments, [info]);
    assert.equal(mailing.body.data.attachmentsMaxSize, MAX_SIZE);

    const response = await fetch(`${base}/mailings/${id}/attachments/${info.id}`, {
      headers: { Authorization: `Bearer ${salesKey}` }
    });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'application/pdf');
    assert.match(response.headers.get('content-disposition')!, /filename\*=UTF-8''%D0%9F/);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), content);
  });

  it('should require a file name and strip the path from it', async () => {
    const id = await create();
    assert.equal((await upload(salesKey, id, null, Buffer.from('x'))).status, 400);
    const uploaded = await upload(salesKey, id, '../../x.pdf', Buffer.from('x'));
    assert.equal(uploaded.status, 201);
    assert.equal(uploaded.body.data.filename, 'x.pdf');
  });

  it('should refuse attachments over the total size limit', async () => {
    const id = await create();
    assert.equal((await upload(salesKey, id, 'a.pdf', Buffer.alloc(1500))).status, 201);
    const second = await upload(salesKey, id, 'b.pdf', Buffer.alloc(1500));
    assert.equal(second.status, 413);
    assert.equal(second.body.success, false);
    const tooBig = await upload(salesKey, id, 'c.pdf', Buffer.alloc(MAX_SIZE + 1));
    assert.equal(tooBig.status, 413);
    assert.equal((await readdir(join(dir, String(id)))).length, 1);
  });

  it('should hide attachments of another space', async () => {
    const id = await create();
    const { body } = await upload(salesKey, id, 'a.pdf', Buffer.from('x'));
    const attachmentId = body.data.id;
    assert.equal((await upload(newsKey, id, 'b.pdf', Buffer.from('x'))).status, 404);
    const download = await fetch(`${base}/mailings/${id}/attachments/${attachmentId}`, {
      headers: { Authorization: `Bearer ${newsKey}` }
    });
    assert.equal(download.status, 404);
    const removed = await request(newsKey, 'DELETE', `/mailings/${id}/attachments/${attachmentId}`);
    assert.equal(removed.status, 404);
    assert.equal(await store.exists(id, attachmentId), true);
  });

  it('should not change attachments of a running mailing', async () => {
    const id = await create();
    const { body } = await upload(salesKey, id, 'a.pdf', Buffer.from('x'));
    await mailingRepository.updateInTransaction(id, mailing => {
      mailing.state = MailingState.RUNNING;
    });
    assert.equal((await upload(salesKey, id, 'b.pdf', Buffer.from('x'))).status, 409);
    const path = `/mailings/${id}/attachments/${body.data.id}`;
    const removed = await request(salesKey, 'DELETE', path);
    assert.equal(removed.status, 409);
    assert.equal((await mailingRepository.getById(id))!.attachments.length, 1);
  });

  it('should delete an attachment', async () => {
    const id = await create();
    const { body } = await upload(salesKey, id, 'a.pdf', Buffer.from('x'));
    const path = `/mailings/${id}/attachments/${body.data.id}`;
    assert.equal((await request(salesKey, 'DELETE', path)).status, 200);
    assert.equal(await store.exists(id, body.data.id), false);
    assert.deepEqual((await mailingRepository.getById(id))!.attachments, []);
    assert.equal((await request(salesKey, 'DELETE', path)).status, 404);
    const unknown = await request(salesKey, 'DELETE', `/mailings/${id}/attachments/nope`);
    assert.equal(unknown.status, 404);
  });

  it('should keep both of two simultaneous uploads', async () => {
    const id = await create();
    const results = await Promise.all([
      upload(salesKey, id, 'a.pdf', Buffer.from('a')),
      upload(salesKey, id, 'b.pdf', Buffer.from('b'))
    ]);
    assert.deepEqual(results.map(r => r.status), [201, 201]);
    const names = (await mailingRepository.getById(id))!.attachments.map(a => a.filename);
    assert.deepEqual(names.sort(), ['a.pdf', 'b.pdf']);
  });

  it('should answer 503 without an attachment store', async () => {
    const id = await create();
    const uploaded = await upload(salesKey, id, 'a.pdf', Buffer.from('x'), undefined, noStoreBase);
    assert.equal(uploaded.status, 503);
    assert.equal(uploaded.body.code, 'ATTACHMENTS_UNAVAILABLE');
  });
  describe('with mailings', () => {
    const pdf = Buffer.from('%PDF-1.4 price list');

    async function download (id: number, attachmentId: string) {
      const response = await fetch(`${base}/mailings/${id}/attachments/${attachmentId}`, {
        headers: { Authorization: `Bearer ${salesKey}` }
      });
      assert.equal(response.status, 200);
      return Buffer.from(await response.arrayBuffer());
    }

    it('should create a mailing with attachments in one request', async () => {
      const id = await create(salesKey, {
        ...mailingBody, attachments: [{ content: pdf.toString('base64'), filename: 'p.pdf' }]
      });
      const [info] = (await mailingRepository.getById(id))!.attachments;
      assert.equal(info.filename, 'p.pdf');
      assert.equal(info.contentType, 'application/pdf');
      assert.equal(info.size, pdf.length);
      assert.deepEqual(await download(id, info.id), pdf);
    });

    it('should refuse to create a mailing with too large attachments', async () => {
      const content = Buffer.alloc(MAX_SIZE + 1).toString('base64');
      const result = await request(salesKey, 'POST', '/mailings', {
        ...mailingBody, attachments: [{ content, filename: 'big.pdf' }]
      });
      assert.equal(result.status, 413);
      assert.deepEqual(await mailingRepository.getAll(), []);
    });

    it('should refuse attachments without a name or content', async () => {
      const invalid = [
        { content: 'eA==' }, { filename: 'a.pdf' }, { content: 'eA==', filename: ' ' }
      ];
      for (const attachment of invalid) {
        const result = await request(salesKey, 'POST', '/mailings', {
          ...mailingBody, attachments: [attachment]
        });
        assert.equal(result.status, 400, JSON.stringify(attachment));
      }
      assert.deepEqual(await mailingRepository.getAll(), []);
    });

    it('should copy attachments to a copy of the mailing', async () => {
      const id = await create();
      const { body } = await upload(salesKey, id, 'p.pdf', pdf);
      const copyId = await create(salesKey, { sourceId: id });
      const [copied] = (await mailingRepository.getById(copyId))!.attachments;
      assert.notEqual(copied.id, body.data.id);
      assert.equal(copied.filename, 'p.pdf');
      assert.deepEqual(await download(copyId, copied.id), pdf);
    });

    it('should copy attachments to a retry mailing', async () => {
      const id = await create();
      await upload(salesKey, id, 'p.pdf', pdf);
      await mailingRepository.setFailure(id, {
        date: new Date().toISOString(), email: 'ivan@example.com', spam: false, status: '5.1.1'
      });
      const retry = await request(salesKey, 'POST', '/mailings/create-retry', { sourceId: id });
      assert.equal(retry.status, 200, JSON.stringify(retry.body));
      const [copied] = (await mailingRepository.getById(retry.body.data.id))!.attachments;
      assert.equal(copied.filename, 'p.pdf');
      assert.deepEqual(await download(retry.body.data.id, copied.id), pdf);
    });

    it('should remove attachment files with the mailing', async () => {
      const id = await create();
      await upload(salesKey, id, 'p.pdf', pdf);
      assert.equal((await request(salesKey, 'DELETE', `/mailings/${id}`)).status, 200);
      assert.equal((await readdir(dir)).includes(String(id)), false);
    });

    it('should not change attachments with an update of the mailing', async () => {
      const id = await create();
      await upload(salesKey, id, 'p.pdf', pdf);
      const result = await request(salesKey, 'PUT', `/mailings/${id}`, { attachments: [] });
      assert.equal(result.status, 400);
      assert.equal((await mailingRepository.getById(id))!.attachments.length, 1);
    });
  });
  describe('letters', () => {
    it('should list attachments in the preview', async () => {
      const id = await create();
      await upload(salesKey, id, 'p.pdf', Buffer.from('%PDF'));
      const preview = await request(salesKey, 'POST', `/mailings/${id}/preview`, {
        email: 'ivan@example.com'
      });
      assert.equal(preview.status, 200, JSON.stringify(preview.body));
      assert.deepEqual(preview.body.data.attachments, [
        { contentType: 'application/pdf', filename: 'p.pdf', size: 4 }
      ]);
    });

    it('should refuse a test letter and a start without an attachment file', async () => {
      const id = await create();
      const { body } = await upload(salesKey, id, 'p.pdf', Buffer.from('%PDF'));
      await store.remove(id, body.data.id);
      const test = await request(salesKey, 'POST', `/mailings/${id}/send-test-email`, {
        email: 'me@example.com'
      });
      assert.equal(test.status, 409);
      assert.equal(test.body.code, 'MISSING_ATTACHMENT');
      assert.match(test.body.error, /p\.pdf/);
      const start = await request(salesKey, 'PUT', `/mailings/${id}`, { state: 'RUNNING' });
      assert.equal(start.status, 409);
      assert.equal(start.body.code, 'MISSING_ATTACHMENT');
      assert.equal((await mailingRepository.getById(id))!.state, MailingState.NEW);
    });
  });
});
