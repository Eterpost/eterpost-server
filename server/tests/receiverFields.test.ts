import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { collectFieldStats } from 'eterpost-letter-editor/fields';
import { getReceiverFields } from '../src/controllers/getReceiverFields';


const receivers = [
  { email: 'a@example.com', extraData: { city: 'Москва' }, name: 'Анна' },
  { email: 'b@example.com', extraData: { city: '', 'Дата продления': '01.12' }, name: '' },
  { email: 'c@example.com', extraData: { city: 'Тверь', 'Дата продления': '02.12' }, name: 'Ия' }
];

describe('getReceiverFields', function () {
  it('serves the summary over all saved receivers', async function () {
    const mailing = {
      async *getReceiversStream () {
        yield* receivers;
      }
    };
    let body: any;
    const res = {
      json (data: unknown) {
        body = data;
        return res;
      },
      locals: { mailing },
      status () {
        return res;
      }
    };
    await (getReceiverFields() as any)({}, res, () => {});
    assert.equal(body.success, true);
    assert.deepEqual(body.data, collectFieldStats(receivers));
  });
});
