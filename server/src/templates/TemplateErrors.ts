/**
 * Шаблон не собирается: синтаксическая ошибка Handlebars или ошибка при
 * подстановке (например, неизвестный помощник). field — какое поле рассылки
 * (subject, html), заполняется в Mailing
 */
export class TemplateError extends Error {
  field?: string;

  constructor (message: string) {
    super(message);
    this.name = 'TemplateError';
  }
}

/**
 * Не удалось получить внешнее содержимое для помощников external_content*
 */
export class ExternalContentError extends Error {
  constructor (message: string) {
    super(message);
    this.name = 'ExternalContentError';
  }
}
