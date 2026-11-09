import { MailingFailure, MailingRepository } from './MailingRepository';
import { AddressStatsRepository } from './AddressStatsRepository';
import { AddressStats } from './AddressStats';
import { Mailing } from './Mailing';


export interface FailedReceiver {
  /**
   * Когда записана ошибка (ISO)
   */
  date?: string;
  diagnosticCode?: string;
  email: string;
  /**
   * Адрес уже исключён из рассылки (mail-sorter, POST /mailings/unsubscribe)
   */
  excluded?: boolean;
  /**
   * Рассылка, в которой возникла ошибка, если известна: у исключённого адреса
   * это может быть другая рассылка
   */
  mailingId?: number;
  spam: boolean;
  status: string;
}

/**
 * Ошибки доставки рассылки. Основной источник — список ошибок самой рассылки
 * (mail-sorter по List-Id из DSN, отказы на RCPT TO). Для адресов без записи
 * в нём — последняя ошибка адреса, если она случилась в этой рассылке или
 * рассылка неизвестна (DSN без List-Id, ошибки, записанные до появления
 * списка) и она новее рассылки. Исключённые адреса показываются с последней
 * ошибкой, где бы она ни случилась: их можно вернуть в рассылку
 */
export class FailureCounter {
  constructor (
    private mailingRepository: MailingRepository,
    private statsRepository: AddressStatsRepository
  ) {}

  async getFailedReceivers (mailing: Mailing, limit?: number | null): Promise<FailedReceiver[]> {
    const emails = (await this.mailingRepository.getReceivers(mailing.id))
      .map(receiver => receiver.email);
    const inList = new Set(emails);
    const excluded = (await this.mailingRepository.getExcludedEmails(mailing.id))
      .filter(email => !inList.has(email));
    emails.push(...excluded);
    const failures = await this.mailingRepository.getFailures(mailing.id);

    const statsList: FailedReceiver[] = [];
    const actualLimit = limit ? Math.min(limit, emails.length) : emails.length;
    for (let i = 0; i < actualLimit; i++) {
      const email = emails[i];
      const isExcluded = !inList.has(email);
      const failure = failures.get(email);
      const item = failure ?
        fromFailure(failure, mailing.id) :
        fromStats(await this.statsRepository.getByEmail(email), mailing, isExcluded);
      if (item) {
        statsList.push(isExcluded ? { ...item, excluded: true } : item);
      }
    }

    return statsList;
  }
}

function fromFailure (failure: MailingFailure, mailingId: number): FailedReceiver {
  return {
    date: failure.date,
    diagnosticCode: failure.diagnosticCode,
    email: failure.email,
    mailingId,
    spam: failure.spam,
    status: failure.status
  };
}

function fromStats (
  stats: AddressStats | null, mailing: Mailing, excluded: boolean
): FailedReceiver | null {
  // Нет записи — с адресом всё в порядке; нет lastStatus — «битая» запись
  if (!stats || !stats.lastStatus) {
    return null;
  }
  // Ошибка до создания рассылки — не её
  if (mailing.creationDate && stats.lastStatusDate &&
      mailing.creationDate > stats.lastStatusDate) {
    return null;
  }
  // Ошибка другой рассылки
  if (!excluded && stats.lastMailingId && stats.lastMailingId !== mailing.id) {
    return null;
  }
  return {
    date: stats.lastStatusDate && stats.lastStatusDate.toISOString(),
    diagnosticCode: stats.diagnosticCode,
    email: stats.email,
    mailingId: stats.lastMailingId,
    spam: stats.spam,
    status: stats.lastStatus
  };
}
