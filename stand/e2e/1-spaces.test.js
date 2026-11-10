// Этап 1: пространства рассылок. Один адрес в рассылках двух пространств;
// в ящик noreply@example.com приходит письмо об отписке от рассылки sales
const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const {
  api, NEWS_KEY, rawApi, readMailbox, SALES_KEY, sendRaw, waitFor
} = require('./lib');


const MailingState = { FINISHED: 4, RUNNING: 2 };
const ADDRESS = 'dave@example.com';

async function createAndSend (name, key) {
  const created = await api('/mailings', 'POST', {
    html: '<p>Новости {{receiver.name}}</p>',
    name,
    receivers: [{ email: ADDRESS, name: 'Dave' }],
    subject: name
  }, key);
  await api(`/mailings/${created.id}`, 'PUT', { state: MailingState.RUNNING }, key);
  await waitFor(async () => {
    const current = await api(`/mailings/${created.id}`, 'GET', undefined, key);
    return current.state === MailingState.FINISHED && current.sentCount === 1;
  }, { what: `mailing ${name} to finish` });
  return created.id;
}

describe('mailing spaces', function () {
  let salesId;
  let newsId;

  before(async function () {
    salesId = await createAndSend('E2E sales', SALES_KEY);
    newsId = await createAndSend('E2E news', NEWS_KEY);
  });

  it('creates mailings in the space of the key', async function () {
    assert.equal((await api(`/mailings/${salesId}`, 'GET', undefined, SALES_KEY)).space, 'sales');
    assert.equal((await api(`/mailings/${newsId}`, 'GET', undefined, NEWS_KEY)).space, 'news');
  });

  it('hides a mailing of another space (404)', async function () {
    const foreign = await rawApi(`/mailings/${newsId}`, 'GET', undefined, SALES_KEY);
    assert.equal(foreign.status, 404);
    const own = await api('/mailings', 'GET', undefined, SALES_KEY);
    assert.ok(!own.some(m => m.id === newsId));
  });

  it('puts the mailing number into List-Unsubscribe', async function () {
    const messages = await waitFor(async () => {
      const list = await readMailbox(ADDRESS);
      return list.length >= 2 ? list : null;
    }, { what: 'both mailings for ' + ADDRESS });
    const headers = messages.map(m => m.parsed.headerLines
      .find(h => h.key === 'list-unsubscribe').line);
    assert.ok(headers.some(h => h.includes(`noreply+unsubscribe-${salesId}@`)), headers.join());
    assert.ok(headers.some(h => h.includes(`noreply+unsubscribe-${newsId}@`)), headers.join());
  });

  it('delivers the unsubscribe letter for the sales mailing', async function () {
    // как у настоящего MTA: в ящик noreply@, адрес с тегом остаётся в заголовке To
    await sendRaw('noreply@example.com', [
      `From: Dave <${ADDRESS}>`,
      `To: noreply+unsubscribe-${salesId}@example.com`,
      'Subject: unsubscribe',
      'Date: ' + new Date().toUTCString(),
      'Message-ID: <unsubscribe-1@example.com>',
      'Content-Type: text/plain; charset=utf-8',
      '',
      'Отпишите меня',
      ''
    ].join('\r\n'));
    await waitFor(async () => {
      const list = await readMailbox('noreply@example.com');
      return list.some(m => m.parsed.subject === 'unsubscribe');
    }, { what: 'unsubscribe letter in noreply mailbox' });
  });
});
