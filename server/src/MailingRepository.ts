import { Mailing, MailingProperties } from './Mailing';
import { Receiver, ReceiverProperties } from './Receiver';


/**
 * Получатель, которому сервер временно отказал на RCPT TO (4xx): письмо ему
 * отправляется ещё раз после основного прохода рассылки
 */
export interface RcptRetry {
  // Сколько повторов уже сделано
  attempts: number;
  email: string;
  // Когда повторить (мс с начала эпохи)
  nextAt: number;
  // Последний ответ сервера
  response: string;
}


/**
 * Ошибка доставки письма рассылки получателю. Записывается mail-sorter (по
 * List-Id из DSN) и mail-server (отказ на RCPT TO)
 */
export interface MailingFailure {
  /**
   * Когда записана (ISO)
   */
  date: string;
  diagnosticCode?: string;
  email: string;
  spam: boolean;
  status: string;
}

/**
 * Письмо получателю с отслеживанием: адрес и исходные ссылки по номерам
 */
export interface TrackedLetter {
  email: string;
  links: string[];
}

/**
 * Открытия и переходы по рассылке: дата первого события по адресам и число
 * переходов по каждой ссылке
 */
export interface TrackingStats {
  clicks: Map<string, string>;
  linkClicks: Map<string, number>;
  opens: Map<string, string>;
}

/**
 * Отписка получателя от рассылки: link — по ссылке из письма
 * (subscription-facade), mail — письмом или кнопкой List-Unsubscribe (mail-sorter)
 */
export interface MailingUnsubscribe {
  date: string;
  email: string;
  method: 'link' | 'mail';
  name?: string;
}

/**
 * Интерфейс хранилища, содержащего информацию о рассылках (как выполненных,
 * так и выполняющихся)
 */
export interface MailingRepository {
  addReceiver (mailingId: number, receiver: Receiver): Promise<void>;
  advancePosition (mailingId: number, receiver: Receiver, sent: boolean): Promise<Mailing | null>;
  create (properties: MailingProperties, receivers: ReceiverProperties[]): Promise<Mailing>;
  /**
   * Получение рассылок из хранилища
   */
  getAll (): Promise<Mailing[]>;
  getById (id: number): Promise<Mailing | null>;
  getByListId (listId: string): Promise<Mailing | null>;
  /**
   * Адреса, исключённые из рассылки из-за ошибок доставки
   */
  getExcludedEmails (id: number): Promise<string[]>;
  /**
   * Ошибки доставки писем этой рассылки по адресам
   */
  getFailures (id: number): Promise<Map<string, MailingFailure>>;
  setFailure (id: number, failure: MailingFailure): Promise<void>;
  /**
   * Отслеживание: токен письма → адрес и ссылки, события открытия и перехода
   */
  setTrackedLetter (id: number, token: string, letter: TrackedLetter): Promise<void>;
  getTrackedLetter (id: number, token: string): Promise<TrackedLetter | null>;
  recordOpen (id: number, email: string, date: Date): Promise<void>;
  recordClick (id: number, email: string, url: string, date: Date): Promise<void>;
  getTrackingStats (id: number): Promise<TrackingStats>;
  /**
   * Когда получателю последний раз отправлено письмо рассылки
   */
  recordSent (id: number, email: string, date: Date): Promise<void>;
  getSent (id: number): Promise<Map<string, string>>;
  recordUnsubscribe (id: number, unsubscribe: MailingUnsubscribe): Promise<void>;
  getUnsubscribes (id: number): Promise<Map<string, MailingUnsubscribe>>;
  /**
   * Сколько адресов открыло письмо и сколько перешло по ссылкам
   */
  getTrackingCounts (id: number): Promise<{ clicked: number, opened: number }>;
  /**
   * Получение списка получателей
   */
  getReceivers (id: number, start?: number, stop?: number): Promise<Receiver[]>;
  getReceiverCount (id: number): Promise<number>;
  getNextReceiver (id: number): Promise<Receiver | null>;
  /**
   * Повторы отправки после временного отказа на RCPT TO, по времени повтора
   */
  getRetries (id: number): Promise<RcptRetry[]>;
  setRetry (id: number, retry: RcptRetry): Promise<void>;
  removeRetry (id: number, email: string): Promise<void>;
  clearRetries (id: number): Promise<void>;
  setReceivers (id: number, receivers: Receiver[]): Promise<void>;
  remove (mailing: Mailing): Promise<void>;
  removeReceiver (id: number, receiver: Receiver, excluded?: boolean): Promise<boolean>;
  /**
   * Вернуть в рассылку адреса, исключённые из-за ошибок доставки (все или emails)
   */
  restoreExcluded (id: number, emails?: string[]): Promise<string[]>;
  update (mailing: Mailing): Promise<void>;
  updateInTransaction (
    mailingId: number, scenario: (mailing: Mailing) => Promise<void> | void
  ): Promise<Mailing | null>;
}
