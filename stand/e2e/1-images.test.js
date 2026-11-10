// Этап 1: картинки писем (ipfs-images за nginx веб-интерфейса). Картинка
// загружается из редактора и отдаётся по адресу с хешем и именем
const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { CLIENT_URL } = require('./lib');


const PNG = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d' +
  '49444154789c6360000002000154a24f5d0000000049454e44ae426082', 'hex');

async function upload (content, filename, type) {
  const form = new FormData();
  form.append('file', new Blob([content], { type }), filename);
  return fetch(`${CLIENT_URL}/images/ul`, { body: form, method: 'POST' });
}

describe('letter images', function () {
  it('should upload a picture and serve it by its address', async () => {
    const response = await upload(PNG, 'Картинка один.png', 'image/png');
    assert.equal(response.status, 200);
    const { id, mime } = await response.json();
    assert.equal(mime, 'image/png');

    const url = `${CLIENT_URL}/images/dl/${id}/${encodeURIComponent('Картинка один.png')}`;
    const image = await fetch(url);
    assert.equal(image.status, 200);
    assert.equal(image.headers.get('content-type'), 'image/png');
    assert.equal(image.headers.get('x-content-type-options'), 'nosniff');
    assert.deepEqual(Buffer.from(await image.arrayBuffer()), PNG);
  });

  it('should refuse HTML disguised as a picture', async () => {
    const response = await upload(Buffer.from('<script>alert(1)</script>'), 'x.png', 'image/png');
    assert.equal(response.status, 415);
  });
});
