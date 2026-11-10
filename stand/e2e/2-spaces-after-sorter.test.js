// Этап 2: письмо на noreply+unsubscribe-<номер>@ после mail-sorter исключило
// адрес только из рассылки своего пространства
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { api, findMailing, NEWS_KEY, SALES_KEY } = require('./lib');


const ADDRESS = 'dave@example.com';

describe('mailing spaces after mail-sorter', function () {
  it('removed the address from the sales mailing', async function () {
    const mailing = await findMailing('E2E sales', SALES_KEY);
    const receivers = await api(`/mailings/${mailing.id}/receivers`, 'GET', undefined, SALES_KEY);
    assert.ok(!receivers.list.some(r => r.email === ADDRESS));
  });

  it('kept the address in the news mailing', async function () {
    const mailing = await findMailing('E2E news', NEWS_KEY);
    const receivers = await api(`/mailings/${mailing.id}/receivers`, 'GET', undefined, NEWS_KEY);
    assert.ok(receivers.list.some(r => r.email === ADDRESS));
  });
});
