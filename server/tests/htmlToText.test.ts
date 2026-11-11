import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { htmlToText } from '../src/composeMessage';


// Обёртка письма свёрстана таблицами, внутри — таблица данных
const html =
  '<table><tr><td><p>Добрый день!</p><p>Цены на лицензии:</p>' +
  '<table class="data-table">' +
  '<tr><th>Продукт</th><th>до 50 польз.</th><th>51–200</th><th>от 201</th></tr>' +
  '<tr><td>Рабочая станция</td><td>2 500 ₽</td><td>2 200 ₽</td><td>1 900 ₽</td></tr>' +
  '<tr><td>Сервер</td><td>9 000 ₽</td><td>8 100 ₽</td><td>7 300 ₽</td></tr>' +
  '<tr><td>Поддержка «Расширенная», год</td><td colspan="3">40 % от цены лицензии</td></tr>' +
  '</table>' +
  '<p>С уважением, отдел продаж</p></td></tr></table>';


describe('htmlToText', () => {
  it('should lay out a data-table in columns and keep the wrapper as paragraphs', () => {
    const lines = htmlToText(html).split('\n').map(line => line.trimEnd());

    assert.ok(lines.includes('Добрый день!'));
    assert.ok(lines.includes('С уважением, отдел продаж'));

    const header = lines.find(line => line.startsWith('Продукт'));
    assert.ok(header, 'header row is on its own line');
    assert.match(header, /^Продукт\s{2,}до 50 польз\.\s{2,}51–200\s{2,}от 201$/);

    const workstation = lines.find(line => line.startsWith('Рабочая станция'));
    assert.ok(workstation);
    assert.match(workstation, /^Рабочая станция\s{2,}2 500 ₽\s{2,}2 200 ₽\s{2,}1 900 ₽$/);
    // Столбцы выровнены по шапке
    assert.equal(workstation.indexOf('2 500 ₽'), header.indexOf('до 50 польз.'));

    const support = lines.find(line => line.startsWith('Поддержка'));
    assert.ok(support);
    assert.match(support, /^Поддержка «Расширенная», год\s{2,}40 % от цены лицензии$/);
  });

  it('should not lay out tables without the data-table class in columns', () => {
    const text = htmlToText('<table><tr><td>Один</td><td>Два</td></tr></table>');
    // Как и раньше: таблица без класса выводится одним абзацем
    assert.equal(text, 'ОдинДва');
  });
});
