// Этап 1: вложения. PDF, приложенный к рассылке, приходит вложением и в
// пробном письме, и в письме рассылки; дубль рассылки уходит с тем же файлом
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { api, MAIL_SERVER_URL, rawApi, readMailbox, SALES_KEY, waitFor } = require('./lib');


const MailingState = { FINISHED: 4, RUNNING: 2 };
const PDF = Buffer.from('%PDF-1.4\n% E2E прайс-лист\n%%EOF\n');
const FILENAME = 'Прайс ноябрь.pdf';

async function priceAttachment (user) {
  const letters = await readMailbox(user);
  for (const letter of letters) {
    const found = letter.parsed.attachments.find(a => a.filename === FILENAME);
    if (found) {
      return found;
    }
  }
  return null;
}

describe('attachments', function () {
  it('should send the attached file in the test letter and in the mailing', async () => {
    const { id } = await api('/mailings', 'POST', {
      attachments: [{ content: PDF.toString('base64'), filename: FILENAME }],
      html: '<p>Прайс во вложении</p>',
      name: 'E2E вложения',
      receivers: [{ email: 'erin@example.com' }],
      subject: 'Прайс'
    });

    await api(`/mailings/${id}/send-test-email`, 'POST', { email: 'tester@example.com' });
    const inTest = await waitFor(() => priceAttachment('tester@example.com'), {
      what: 'test letter with the attachment'
    });
    assert.equal(inTest.contentType, 'application/pdf');
    assert.deepEqual(inTest.content, PDF);

    await api(`/mailings/${id}`, 'PUT', { state: MailingState.RUNNING });
    await waitFor(async () => {
      const current = await api(`/mailings/${id}`);
      return current.state === MailingState.FINISHED && current.sentCount === 1;
    }, { what: 'mailing with the attachment to finish' });
    const inMailing = await waitFor(() => priceAttachment('erin@example.com'), {
      what: 'mailing letter with the attachment'
    });
    assert.deepEqual(inMailing.content, PDF);
  });

  it('should upload, download and copy an attachment', async () => {
    const { id } = await api('/mailings', 'POST', {
      html: '<p>Прайс</p>', name: 'E2E загрузка вложения',
      receivers: [{ email: 'frank@example.com' }], subject: 'Прайс'
    });
    const response = await fetch(
      `${MAIL_SERVER_URL}/mailings/${id}/attachments?filename=${encodeURIComponent(FILENAME)}`,
      {
        body: PDF,
        headers: { Authorization: `Bearer ${SALES_KEY}`, 'Content-Type': 'application/pdf' },
        method: 'POST'
      }
    );
    assert.equal(response.status, 201);
    const info = (await response.json()).data;

    const copy = await api('/mailings', 'POST', { sourceId: id });
    const [copied] = (await api(`/mailings/${copy.id}`)).attachments;
    assert.equal(copied.filename, FILENAME);
    const copyUrl = `${MAIL_SERVER_URL}/mailings/${copy.id}/attachments/${copied.id}`;
    const downloaded = await fetch(copyUrl, {
      headers: { Authorization: `Bearer ${SALES_KEY}` }
    });
    assert.deepEqual(Buffer.from(await downloaded.arrayBuffer()), PDF);

    const removed = await rawApi(`/mailings/${id}/attachments/${info.id}`, 'DELETE');
    assert.equal(removed.status, 200);
    assert.deepEqual((await api(`/mailings/${id}`)).attachments, []);
  });
});
