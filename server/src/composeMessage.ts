import { convert } from 'html-to-text';
import { Email } from './Email';


// Картинки пропускаем: в тексте от них остались бы только адреса или data: URI
const htmlToTextOptions = {
  selectors: [
    { options: { hideLinkHrefIfSameAsText: true }, selector: 'a' },
    { format: 'skip', selector: 'img' }
  ]
};


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
    html: email.html,
    replyTo: email.replyTo,
    // Возвраты всегда идут на адрес сервиса (его разбирает mail-sorter),
    // даже если у рассылки свой From
    sender: email.from ? serviceFrom : undefined,
    subject: email.subject,
    text: email.text || (email.html ? convert(email.html, htmlToTextOptions) : undefined),
    // В заголовке «Кому» — с именем, nodemailer сам закодирует кириллицу
    to: email.receivers.map(receiver =>
      receiver.name ? { address: receiver.email, name: receiver.name } : receiver.email
    )
  };
}
