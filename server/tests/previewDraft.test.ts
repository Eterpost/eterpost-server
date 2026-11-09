import { describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeLogger } from './testing-utils';
import { MailingExecutor } from '../src/MailingExecutor';
import { Mailing } from '../src/Mailing';
import { previewDraft } from '../src/controllers/previewDraft';
import { previewEmail } from '../src/controllers/previewEmail';


const config = {
  server: {
    mail: {
      from: 'no-reply@etersoft.ru',
      listIdDomain: 'example.com',
      listUnsubscribe: '<mailto:unsubscribe@etersoft.ru>'
    }
  }
};

const mailer = { sendEmail: mock.fn(async () => {}) };
const executor = new MailingExecutor(
  mailer, {} as any, {} as any, createFakeLogger(), config
);

// Прогоняет обработчики express по очереди, как это сделал бы маршрут
async function call (handlers: unknown[], body: unknown, params: Record<string, string> = {}) {
  let status = 200;
  let result: any;
  const res = {
    json (data: any) {
      result = data;
      return res;
    },
    status (code: number) {
      status = code;
      return res;
    }
  };
  const req = { body, params };
  for (const handler of handlers as any[]) {
    let nextCalled = false;
    await handler(req, res, () => {
      nextCalled = true;
    });
    if (!nextCalled) {
      break;
    }
  }
  return { body: result, status };
}

const draft = {
  extraData: { season: 'осень' },
  html: '<h1>{{receiver.name}}</h1>' +
    '<p>{{receiver.extraData.city}}, {{mailing.extraData.season}}</p>',
  subject: 'Привет, {{receiver.name}}'
};

describe('POST /preview', () => {
  it('should build a letter for every receiver without sending', async () => {
    const { body, status } = await call(previewDraft(config, executor), {
      ...draft,
      receivers: [
        { email: 'ivan@example.com', extraData: { city: 'Москва' }, name: 'Иван' },
        { email: 'anna@example.com', extraData: { city: 'Казань' }, name: 'Анна' }
      ]
    });
    assert.equal(status, 200);
    assert.equal(mailer.sendEmail.mock.callCount(), 0);
    const letters = body.data;
    assert.equal(letters.length, 2);
    assert.equal(letters[0].subject, 'Привет, Иван');
    assert.equal(letters[0].html, '<h1>Иван</h1><p>Москва, осень</p>');
    assert.match(letters[0].text, /^ИВАН$/m);
    assert.deepEqual(letters[0].to, [{ address: 'ivan@example.com', name: 'Иван' }]);
    assert.equal(letters[0].from, 'no-reply@etersoft.ru');
    assert.equal(letters[0].sender, undefined);
    assert.match(letters[0].headers['List-Id'], /^<\d{8}-0\.eterpost\.example\.com>$/);
    assert.equal(letters[0].headers['List-Unsubscribe'], '<mailto:unsubscribe@etersoft.ru>');
    assert.equal(letters[0].headers.Precedence, 'bulk');
    assert.equal(letters[1].subject, 'Привет, Анна');
    assert.equal(letters[1].html, '<h1>Анна</h1><p>Казань, осень</p>');
  });

  it('should use From, Reply-To and listUnsubscribe of the draft', async () => {
    const { body } = await call(previewDraft(config, executor), {
      ...draft,
      from: 'Sales <sales@etersoft.ru>',
      listUnsubscribe: false,
      receivers: [{ email: 'ivan@example.com' }],
      replyTo: 'sales@etersoft.ru'
    });
    const [letter] = body.data;
    assert.equal(letter.from, 'Sales <sales@etersoft.ru>');
    assert.equal(letter.sender, 'no-reply@etersoft.ru');
    assert.equal(letter.replyTo, 'sales@etersoft.ru');
    assert.equal(letter.headers['List-Unsubscribe'], undefined);
  });

  it('should make up receiver codes for a mailing open for subscription', async () => {
    const { body } = await call(previewDraft(config, executor), {
      html: '<a href="https://example.com/unsubscribe?code={{receiver.code}}">x</a>',
      openForSubscription: true,
      receivers: [{ email: 'ivan@example.com' }, { code: 'c0de', email: 'anna@example.com' }],
      subject: 'test'
    });
    assert.match(body.data[0].html, /code=[0-9a-f-]{36}"/);
    assert.match(body.data[1].html, /code=c0de"/);
  });

  it('should answer 400 with the place of a template error', async () => {
    const html = await call(previewDraft(config, executor), {
      html: '<p>{{#if receiver.name}}</p>', receivers: [{ email: 'ivan@example.com' }],
      subject: 'test'
    });
    assert.equal(html.status, 400);
    assert.equal(html.body.code, 'TEMPLATE_ERROR');
    assert.match(html.body.error, /^html: Parse error on line 1:/);

    const subject = await call(previewDraft(config, executor), {
      html: '<p>ok</p>', receivers: [{ email: 'ivan@example.com' }], subject: '{{unknown 1}}'
    });
    assert.equal(subject.status, 400);
    assert.equal(subject.body.code, 'TEMPLATE_ERROR');
    assert.match(subject.body.error, /^subject: Missing helper: "unknown"/);
  });

  it('should answer 400 for an invalid email', async () => {
    const { body, status } = await call(previewDraft(config, executor), {
      ...draft, receivers: [{ email: 'not-an-email' }]
    });
    assert.equal(status, 400);
    assert.match(body.error, /email/);
  });

  it('should answer 502 when external content cannot be fetched', async () => {
    const { body, status } = await call(previewDraft(config, executor), {
      html: '{{external_content "http://127.0.0.1:1/news.html"}}',
      receivers: [{ email: 'ivan@example.com' }],
      subject: 'test'
    });
    assert.equal(status, 502);
    assert.equal(body.code, 'EXTERNAL_CONTENT_ERROR');
  });
});

describe('POST /mailings/:id/preview', () => {
  it('should answer 400 with the place of a template error', async () => {
    const repository: any = {
      getById: async (id: number) => new Mailing(id, {
        html: '<p>{{#each}}</p>', name: 'test', subject: 'test', undeliveredCount: 0
      }, repository),
      getReceivers: async () => []
    };
    const { body, status } = await call(
      previewEmail(repository, executor), { email: 'ivan@example.com' }, { id: '5' }
    );
    assert.equal(status, 400);
    assert.equal(body.code, 'TEMPLATE_ERROR');
    assert.match(body.error, /^html: Parse error on line 1:/);
  });
});
