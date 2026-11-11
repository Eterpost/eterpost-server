import { convert } from 'html-to-text';
import { Email } from './Email';
import { toEmailDocument } from './emailDocument';


// Картинки пропускаем: в тексте от них остались бы только адреса или data: URI.
// Колонками выводим только таблицы, помеченные отправителем как таблицы данных:
// обёртку письма часто верстают таблицами, её колонками раскладывать нельзя.
// Шапку оставляем в исходном регистре — русские подписи заглавными читаются хуже.
const htmlToTextOptions = {
  selectors: [
    { options: { hideLinkHrefIfSameAsText: true }, selector: 'a' },
    { format: 'skip', selector: 'img' },
    { format: 'dataTable', options: { uppercaseHeaderCells: false }, selector: 'table.data-table' }
  ]
};


/**
 * Текстовая версия письма из HTML
 */
export function htmlToText (html: string): string {
  return convert(html, htmlToTextOptions);
}

export interface MessageAddress {
  address: string;
  name: string;
}

/**
 * Письмо в том виде, в каком оно передаётся nodemailer (кроме конверта)
 */
export interface ComposedMessage {
  attachments?: Email['attachments'];
  from: string;
  headers: Email['headers'];
  html?: string;
  replyTo?: string;
  sender?: string;
  subject: string;
  text?: string;
  to: Array<MessageAddress | string>;
}

/**
 * Собирает письмо для отправки: From, Sender, To с именами получателей и
 * текстовую версию из HTML. Используется и при отправке, и для предпросмотра,
 * чтобы предпросмотр не расходился с отправленным письмом.
 * serviceFrom — адрес сервиса (server.mail.from)
 */
export function composeMessage (email: Email, serviceFrom: string): ComposedMessage {
  return {
    attachments: email.attachments,
    from: email.from || serviceFrom,
    headers: email.headers,
    // Фрагмент — в документ, который почтовик может показать в тёмной теме
    html: email.html ? toEmailDocument(email.html) : email.html,
    replyTo: email.replyTo,
    // Возвраты всегда идут на адрес сервиса (его разбирает mail-sorter),
    // даже если у рассылки свой From
    sender: email.from ? serviceFrom : undefined,
    subject: email.subject,
    text: email.text || (email.html ? htmlToText(email.html) : undefined),
    // В заголовке «Кому» — с именем, nodemailer сам закодирует кириллицу
    to: email.receivers.map(receiver =>
      receiver.name ? { address: receiver.email, name: receiver.name } : receiver.email
    )
  };
}
