import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { decodeReceiversFile, parseReceiverRows } from '../src/receiversCsv.js';


describe('parseReceiverRows', () => {
  it('should put extra columns of a file with a header into extraData', () => {
    const result = parseReceiverRows([
      ['\uFEFFemail', 'Имя', 'city', 'price'],
      ['ivan@example.com', 'Иван', 'Москва', '100'],
      [''],
      ['petr@example.com', '', 'Казань', '']
    ]);
    assert.deepEqual(result, {
      errors: [],
      header: true,
      receivers: [
        { email: 'ivan@example.com', extraData: { city: 'Москва', price: '100' }, name: 'Иван' },
        { email: 'petr@example.com', extraData: { city: 'Казань', price: '' }, name: '' }
      ]
    });
  });

  it('should report rows without an address and broken headers', () => {
    const result = parseReceiverRows([
      ['name', 'email', 'city', 'city'],
      ['Иван', '', 'Москва'],
      ['Пётр', 'petr@example.com', 'Казань', 'x', 'extra']
    ]);
    assert.deepEqual(result.errors, [
      'строка 1: колонка «city» повторяется',
      'строка 2: нет адреса',
      'строка 3: значений больше, чем колонок в заголовке'
    ]);
    assert.deepEqual(result.receivers, []);
  });

  it('should read the old format with JSON, even if it was cut by commas', () => {
    const result = parseReceiverRows([
      ['ivan@example.com', 'Иван', '{"city": "Москва"}'],
      ['petr@example.com', 'Пётр', '{"city": "Казань"', ' "price": 100}'],
      ['anna@example.com'],
      ['bad@example.com', 'X', '{oops'],
      ['arr@example.com', 'X', '[1]']
    ]);
    assert.equal(result.header, false);
    assert.deepEqual(result.receivers, [
      { email: 'ivan@example.com', extraData: { city: 'Москва' }, name: 'Иван' },
      { email: 'petr@example.com', extraData: { city: 'Казань', price: 100 }, name: 'Пётр' },
      { email: 'anna@example.com', extraData: {}, name: '' }
    ]);
    assert.deepEqual(result.errors, [
      'строка 4: третья колонка — не JSON ({oops)',
      'строка 5: в третьей колонке нужен JSON-объект {…}'
    ]);
  });

  it('should cut a long list of errors', () => {
    const rows = [['email'], ...Array.from({ length: 15 }, () => ['', 'x'])];
    const { errors } = parseReceiverRows(rows);
    assert.equal(errors.length, 11);
    assert.equal(errors[10], '…и ещё ошибок: 5');
  });

  it('should take an empty file as no receivers', () => {
    assert.deepEqual(parseReceiverRows([[''], []]), { errors: [], header: false, receivers: [] });
  });
});

describe('decodeReceiversFile', () => {
  it('should read UTF-8 and fall back to windows-1251', () => {
    assert.equal(decodeReceiversFile(new TextEncoder().encode('Иван')), 'Иван');
    // «Иван» в windows-1251
    assert.equal(decodeReceiversFile(new Uint8Array([0xc8, 0xe2, 0xe0, 0xed])), 'Иван');
  });
});
