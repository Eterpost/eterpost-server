import { Email } from './Email.js';


/**
 * Абстрактный интерфейс для отправки почты. Может быть представлен
 * SMTP-сервером или внешним сервисом для отправки почты
 */
export interface MailSender {
  sendEmail (email: Email): Promise<void>;
}
