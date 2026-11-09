import { MailSender } from './MailSender';
import { Email } from './Email';
import { createTransport, Transporter } from 'nodemailer';
import { composeMessage } from './composeMessage';


export interface SmtpMailSenderConfig {
  auth?: {
    pass: string;
    user: string;
  };
  from: string;
  host: string;
  /**
   * Имя в EHLO; по умолчанию — имя системы, если в нём есть точка, иначе
   * nodemailer подставляет [127.0.0.1]
   */
  name?: string;
  port: number | string;
  /**
   * true — TLS сразу (порт 465); false — STARTTLS, если сервер его предлагает
   */
  secure?: boolean;
}

export class SmtpMailSender implements MailSender {
  private transport: Transporter;

  constructor (private config: SmtpMailSenderConfig) {
    this.transport = createTransport({
      auth: config.auth,
      host: config.host,
      name: config.name,
      pool: true,
      port: Number(config.port),
      secure: config.secure
    }, {
      from: this.config.from
    });
  }

  async sendEmail (email: Email): Promise<void> {
    await this.transport.sendMail({
      ...composeMessage(email, this.config.from),
      // Возвраты всегда идут на адрес сервиса (его разбирает mail-sorter)
      envelope: {
        from: this.config.from,
        to: email.receivers.map(receiver => receiver.email)
      }
    });
  }
}
