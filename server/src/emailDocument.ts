// Заголовок документа письма: color-scheme говорит почтовой программе, что
// письмо можно показать и в тёмной теме. Без него фрагмент HTML у
// получателя с тёмной темой остаётся на белом фоне
const HEAD = '<!doctype html>\n<html>\n<head>\n' +
  '<meta charset="utf-8">\n' +
  '<meta name="viewport" content="width=device-width, initial-scale=1">\n' +
  '<meta name="color-scheme" content="light dark">\n' +
  '<meta name="supported-color-schemes" content="light dark">\n' +
  '<style>:root { color-scheme: light dark; supported-color-schemes: light dark; }</style>\n' +
  '</head>\n<body>\n';

const FOOT = '\n</body>\n</html>\n';

export function isHtmlDocument (html: string): boolean {
  return /<!doctype\s|<html[\s>]|<body[\s>]/i.test(html);
}

/**
 * HTML письма как документ. Фрагмент (так пишет редактор) оборачивается в
 * документ со светлой и тёмной темой. Готовый документ не меняется: его
 * цвета задал автор, и тёмная тема могла бы сделать текст нечитаемым
 */
export function toEmailDocument (html: string): string {
  return isHtmlDocument(html) ? html : HEAD + html + FOOT;
}
