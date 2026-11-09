import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeLogger, getTestingRedisConnectionPool, redisSkip } from './testing-utils';
import { RedisConnectionPool } from '../src/RedisConnectionPool';
import { RedisMailingRepository } from '../src/RedisMailingRepository';
import { RedisAddressStatsRepository } from '../src/RedisAddressStatsRepository';
import { FailureCounter } from '../src/FailureCounter';
import { unsubscribeFromAll } from '../src/controllers/unsubscribeFromAll';
import { createRetryMailing } from '../src/controllers/createRetryMailing';
import { restoreExcluded } from '../src/controllers/restoreExcluded';
import { getResults } from '../src/controllers/getResults';


const bounced = 'failure-counter-bounced@example.com';
const failed = 'failure-counter-failed@example.com';
const unsubscribed = 'failure-counter-unsubscribed@example.com';

async function call (
  handlers: unknown, body: Record<string, unknown>, params: Record<string, string> = {}
) {
  let result: any;
  const res = {
    json (data: any) {
      result = data;
      return res;
    },
    status () {
      return res;
    }
  };
  await (handlers as any[])[1]({ body, params }, res);
  return result;
}

describe('FailureCounter', { skip: redisSkip }, () => {
  let redisConnectionPool: RedisConnectionPool;
  let mailingRepository: RedisMailingRepository;
  let statsRepository: RedisAddressStatsRepository;
  let failureCounter: FailureCounter;
  const logger = createFakeLogger();

  before(async () => {
    redisConnectionPool = await getTestingRedisConnectionPool();
    mailingRepository = new RedisMailingRepository(redisConnectionPool);
    statsRepository = new RedisAddressStatsRepository(redisConnectionPool);
    failureCounter = new FailureCounter(mailingRepository, statsRepository);
  });

  after(async () => {
    await redisConnectionPool.close();
  });

  it('should keep addresses excluded for delivery errors in the report', async () => {
    const mailing = await mailingRepository.create({
      creationDate: new Date(Date.now() - 1000),
      html: '<p>Test</p>',
      name: 'test',
      subject: 'test',
      undeliveredCount: 0
    }, [{ email: bounced }, { email: failed }, { email: unsubscribed }]);
    for (const email of [bounced, failed, unsubscribed]) {
      await statsRepository.create({
        email,
        lastStatus: email === unsubscribed ? undefined : '5.1.1',
        lastStatusDate: new Date()
      });
    }

    // mail-sorter: недоставляемый адрес и письмо с просьбой отписаться
    await call(unsubscribeFromAll(mailingRepository, logger), { email: bounced });
    await call(unsubscribeFromAll(mailingRepository, logger), {
      email: unsubscribed, listUnsubscribe: true
    });

    const report = await failureCounter.getFailedReceivers((await mailingRepository.getById(
      mailing.id
    ))!);
    assert.deepEqual(report.map(r => [r.email, Boolean(r.excluded)]), [
      [failed, false], [bounced, true]
    ]);

    const config = { server: { mail: { listIdDomain: 'example.com' } } };
    const retry = await call(createRetryMailing(
      config, mailingRepository, logger, failureCounter
    ), { sourceId: mailing.id });
    const receivers = await mailingRepository.getReceivers(retry.data.id);
    assert.deepEqual(receivers.map(r => r.email), [failed]);

    await mailingRepository.remove(mailing);
    assert.deepEqual(await mailingRepository.getExcludedEmails(mailing.id), []);
  });

  it('should keep receivers and mailing data in the retry mailing', async () => {
    const extraData = { theme: 'autumn' };
    const mailing = await mailingRepository.create({
      creationDate: new Date(Date.now() - 1000),
      extraData,
      html: '<p>{{receiver.name}} {{receiver.code}} {{receiver.extraData.city}}</p>',
      name: 'test',
      openForSubscription: true,
      subject: 'test',
      undeliveredCount: 0
    }, [{
      code: 'c0de', email: failed, extraData: { city: 'Москва' }, name: 'Иван',
      periodicDate: '15'
    }]);
    await statsRepository.create({
      email: failed, lastStatus: '5.7.1', lastStatusDate: new Date()
    });

    const config = { server: { mail: { listIdDomain: 'example.com' } } };
    const retry = await call(createRetryMailing(
      config, mailingRepository, logger, failureCounter
    ), { sourceId: mailing.id });

    const [receiver] = await mailingRepository.getReceivers(retry.data.id);
    assert.deepEqual(
      [receiver.email, receiver.name, receiver.code, receiver.periodicDate, receiver.extraData],
      [failed, 'Иван', 'c0de', '15', { city: 'Москва' }]
    );
    const retryMailing = (await mailingRepository.getById(retry.data.id))!;
    assert.deepEqual(retryMailing.extraData, extraData);
    assert.equal(retryMailing.openForSubscription, true);
    await mailingRepository.remove(mailing);
    await mailingRepository.remove(retryMailing);
  });

  it('should restore an excluded receiver and clear its errors', async () => {
    const mailing = await mailingRepository.create({
      html: '<p>Test</p>', name: 'test', subject: 'test', undeliveredCount: 0
    }, [{ email: bounced, name: 'Иван' }]);
    await statsRepository.create({
      email: bounced, lastStatus: '5.1.1', lastStatusDate: new Date(), sentCount: 3,
      temporaryFailureCount: 2
    });
    await call(unsubscribeFromAll(mailingRepository, logger), { email: bounced });
    assert.deepEqual(await mailingRepository.getReceivers(mailing.id), []);

    const result = await call(
      restoreExcluded(mailingRepository, statsRepository, logger), {}, { id: String(mailing.id) }
    );
    assert.deepEqual(result.data.restored, [bounced]);
    const [receiver] = await mailingRepository.getReceivers(mailing.id);
    assert.equal(receiver.name, 'Иван');
    const stats = await statsRepository.getByEmail(bounced);
    assert.equal(stats!.lastStatus, undefined);
    assert.equal(stats!.temporaryFailureCount, 0);
    assert.equal(stats!.sentCount, 3);
    await mailingRepository.remove(mailing);
  });

  it('should take errors from the list of the mailing', async () => {
    const other = 'failure-counter-other@example.com';
    const mailing = await mailingRepository.create({
      creationDate: new Date(Date.now() - 1000),
      html: '<p>Test</p>', name: 'test', subject: 'test', undeliveredCount: 0
    }, [{ email: failed }, { email: bounced }, { email: other }]);
    const date = new Date();
    // failed: ошибка этой рассылки записана в её списке, а последняя ошибка
    // адреса — уже из другой рассылки
    await mailingRepository.setFailure(mailing.id, {
      date: date.toISOString(), diagnosticCode: '550 5.1.1 User unknown', email: failed,
      spam: false, status: '5.1.1'
    });
    await statsRepository.create({
      email: failed, lastMailingId: mailing.id + 100, lastStatus: '4.2.2', lastStatusDate: date
    });
    // bounced: ошибка в другой рассылке после создания этой — не её ошибка
    await statsRepository.create({
      email: bounced, lastMailingId: mailing.id + 100, lastStatus: '5.1.1', lastStatusDate: date
    });
    // other: ошибка без известной рассылки (DSN без List-Id) — по-старому, по дате
    await statsRepository.create({ email: other, lastStatus: '5.2.2', lastStatusDate: date });

    const report = await failureCounter.getFailedReceivers(mailing);
    assert.deepEqual(report.map(r => [r.email, r.status, r.mailingId]), [
      [failed, '5.1.1', mailing.id], [other, '5.2.2', undefined]
    ]);
    assert.equal(report[0].diagnosticCode, '550 5.1.1 User unknown');

    await mailingRepository.remove(mailing);
    assert.deepEqual(await mailingRepository.getFailures(mailing.id), new Map());
  });

  it('should create a retry only for the errors matching the filter', async () => {
    const addresses = ['spam@mail.ru', 'gone@mail.ru', 'busy@mail.ru', 'spam@gmail.com'];
    const mailing = await mailingRepository.create({
      html: '<p>Test</p>', name: 'test', subject: 'test', undeliveredCount: 0
    }, addresses.map(email => ({ email })));
    const failure = (email: string, status: string, spam: boolean) => mailingRepository.setFailure(
      mailing.id, { date: new Date().toISOString(), email, spam, status }
    );
    await failure('spam@mail.ru', '5.7.1', true);
    await failure('gone@mail.ru', '5.1.1', false);
    await failure('busy@mail.ru', '4.2.2', false);
    await failure('spam@gmail.com', '5.7.1', true);
    const config = { server: { mail: { listIdDomain: 'example.com' } } };
    const retry = (filter: object, dryRun = false) => call(createRetryMailing(
      config, mailingRepository, logger, failureCounter
    ), { dryRun, filter, sourceId: mailing.id });

    const counted = await retry({ domains: ['mail.ru', 'LIST.RU'], spam: true }, true);
    assert.equal(counted.data.count, 1);
    assert.equal(counted.data.id, undefined);

    const created = await retry({ domains: ['mail.ru'], status: '5' });
    const receivers = await mailingRepository.getReceivers(created.data.id);
    assert.deepEqual(receivers.map(r => r.email), ['spam@mail.ru', 'gone@mail.ru']);
    assert.equal((await retry({ status: '4' }, true)).data.count, 1);

    await mailingRepository.remove(mailing);
    await mailingRepository.remove((await mailingRepository.getById(created.data.id))!);
  });

  it('should report the results of a mailing by receiver', async () => {
    const [sent, failedHere, gone, bad] = [
      'results-sent@example.com', 'results-failed@example.com',
      'results-gone@example.com', 'results-bad@example.com'
    ];
    const mailing = await mailingRepository.create({
      html: '<p>Test</p>', name: 'test', subject: 'test', tracking: true, undeliveredCount: 0
    }, [sent, failedHere, gone, bad].map(email => ({ email, name: email.split('@')[0] })));
    const date = new Date();
    for (const email of [sent, failedHere, gone]) {
      await mailingRepository.recordSent(mailing.id, email, date);
    }
    await mailingRepository.setFailure(mailing.id, {
      date: date.toISOString(), email: failedHere, spam: true, status: '5.7.1'
    });
    await statsRepository.create({ email: bad, lastStatus: '5.1.1', lastStatusDate: date });
    await call(unsubscribeFromAll(mailingRepository, logger), { email: bad });
    await call(unsubscribeFromAll(mailingRepository, logger), {
      email: gone, listUnsubscribe: true
    });
    await mailingRepository.recordOpen(mailing.id, sent, date);
    await mailingRepository.recordClick(mailing.id, sent, 'https://example.com/', date);

    const results = async (query: Record<string, string> = {}) => {
      let result: any;
      const res: any = {
        json: (data: any) => { result = data; return res; },
        status: () => res
      };
      await (getResults(mailingRepository, failureCounter) as any)(
        { params: { id: String(mailing.id) }, query }, res
      );
      return result.data;
    };

    const all = await results();
    assert.deepEqual(all.summary, {
      clicked: 1, excluded: 1, failed: 2, opened: 1, receivers: 2, sent: 3, unsubscribed: 1
    });
    const byEmail = new Map(all.list.map((row: any) => [row.email, row]));
    assert.equal((byEmail.get(sent) as any).clickedAt, date.toISOString());
    assert.equal((byEmail.get(failedHere) as any).failure.spam, true);
    assert.deepEqual((byEmail.get(gone) as any).unsubscribed.method, 'mail');
    assert.equal((byEmail.get(gone) as any).name, 'results-gone');
    assert.equal((byEmail.get(bad) as any).excluded, true);

    const unsubscribed = await results({ event: 'unsubscribed' });
    assert.deepEqual(unsubscribed.list.map((row: any) => row.email), [gone]);
    const page = await results({ limit: '1', offset: '1' });
    assert.equal(page.total, 4);
    assert.equal(page.list.length, 1);

    await mailingRepository.remove(mailing);
    assert.deepEqual(await mailingRepository.getSent(mailing.id), new Map());
  });

  it('should report the date and the mailing of an error', async () => {
    const mailing = await mailingRepository.create({
      creationDate: new Date(Date.now() - 1000),
      html: '<p>Test</p>',
      name: 'test',
      subject: 'test',
      undeliveredCount: 0
    }, [{ email: failed }]);
    const date = new Date();
    // Записано до появления списка ошибок рассылки: берётся из статистики адреса
    await statsRepository.create({
      email: failed, lastMailingId: mailing.id, lastStatus: '4.1.1', lastStatusDate: date
    });

    const [report] = await failureCounter.getFailedReceivers(mailing);
    assert.equal(report.date, date.toISOString());
    assert.equal(report.mailingId, mailing.id);
    await mailingRepository.remove(mailing);
  });
});
