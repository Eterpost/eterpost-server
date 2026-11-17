import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import handlebars from 'handlebars';
import {
  canInsertField, checkTemplateFields, collectFieldStats, fieldPlaceholder, fieldTitle,
  findTemplateFields
} from '../src/templateFields';
import { getReceiverFields } from '../src/controllers/getReceiverFields';


const receivers = [
  { email: 'a@example.com', extraData: { city: 'Москва' }, name: 'Анна' },
  { email: 'b@example.com', extraData: { city: '', 'Дата продления': '01.12' }, name: '' },
  { email: 'c@example.com', extraData: { city: 'Тверь', 'Дата продления': '02.12' }, name: 'Ия' }
];

describe('templateFields', function () {
  it('counts filled fields in one pass', function () {
    assert.deepEqual(collectFieldStats(receivers), {
      fields: [
        { emptyExample: 'b@example.com', field: 'name', filled: 2 },
        { emptyExample: 'b@example.com', field: 'extraData.city', filled: 2 },
        { emptyExample: 'a@example.com', field: 'extraData.Дата продления', filled: 2 }
      ],
      total: 3
    });
  });

  it('finds receiver fields inside mustaches only', function () {
    const html = '<p>receiver.name {{receiver.name}}, {{{receiver.extraData.city}}}</p>' +
      '{{#if receiver.extraData.[Дата продления]}}' +
      'до {{receiver.extraData.[Дата продления]}}{{/if}}' +
      '{{~receiver.email~}} {{receiver.names}} {{myreceiver.name}} {{receiver.extraData}}';
    assert.deepEqual(findTemplateFields('Привет, {{receiver.extraData.Город}}', html), [
      'extraData.Город', 'name', 'extraData.city', 'extraData.Дата продления', 'email'
    ]);
  });

  it('makes placeholders that Handlebars fills', function () {
    const extraData = { city: 'Тверь', 'Дата продления': '01.12', true: 'да' };
    const data = { receiver: { extraData, name: 'Ия' } };
    const template = ['name', 'extraData.city', 'extraData.Дата продления', 'extraData.true']
      .map(fieldPlaceholder).join('|');
    assert.equal(template, '{{receiver.name}}|{{receiver.extraData.city}}|' +
      '{{receiver.extraData.[Дата продления]}}|{{receiver.extraData.[true]}}');
    assert.equal(handlebars.compile(template)(data), 'Ия|Тверь|01.12|да');
    assert.deepEqual(findTemplateFields(template),
      ['name', 'extraData.city', 'extraData.Дата продления', 'extraData.true']);
    assert.equal(canInsertField('extraData.a]b'), false);
    assert.equal(fieldTitle('extraData.city'), 'city');
  });

  it('warns about empty and unknown fields', function () {
    const stats = collectFieldStats(receivers);
    const problems = checkTemplateFields(
      ['{{receiver.extraData.City}}', '{{receiver.name}} {{receiver.email}} ' +
        '{{receiver.extraData.[Дата продления]}} {{receiver.extraData.tariff}}'],
      stats
    );
    assert.deepEqual(problems, [
      { empty: 3, field: 'extraData.City', kind: 'absent', similar: 'extraData.city' },
      { empty: 1, example: 'b@example.com', field: 'name', kind: 'partly' },
      { empty: 1, example: 'a@example.com', field: 'extraData.Дата продления', kind: 'partly' },
      { empty: 3, field: 'extraData.tariff', kind: 'absent', similar: undefined }
    ]);
    const noNames = collectFieldStats([{ email: 'a@example.com' }]);
    assert.deepEqual(checkTemplateFields(['{{receiver.name}}'], noNames),
      [{ empty: 1, field: 'name', kind: 'empty' }]);
    assert.deepEqual(checkTemplateFields(['{{receiver.name}}'], collectFieldStats([])), []);
  });

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
