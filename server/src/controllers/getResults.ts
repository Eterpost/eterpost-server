import { Request, Response } from 'express';
import { MailingRepository } from '../MailingRepository';
import { FailureCounter } from '../FailureCounter';
import { success, error } from '../utils/response';
import { catchPromise } from '../utils/catchPromise';
import { serveCsv } from '../utils/serveCsv';


export interface ReceiverResult {
  /**
   * Когда отписался (ISO) и как: link — по ссылке, mail — письмом или кнопкой
   * List-Unsubscribe
   */
  unsubscribed?: { date: string, method: 'link' | 'mail' };
  clickedAt?: string;
  email: string;
  /**
   * Исключён из рассылки из-за ошибок доставки
   */
  excluded?: boolean;
  failure?: { date?: string, diagnosticCode?: string, spam: boolean, status: string };
  name?: string;
  openedAt?: string;
  /**
   * Когда последний раз отправлено письмо (ISO)
   */
  sentAt?: string;
}

export const RESULT_EVENTS = [
  'sent', 'failed', 'excluded', 'unsubscribed', 'opened', 'clicked'
] as const;
type ResultEvent = typeof RESULT_EVENTS[number];

const hasEvent: Record<ResultEvent, (row: ReceiverResult) => boolean> = {
  clicked: row => Boolean(row.clickedAt),
  excluded: row => Boolean(row.excluded),
  failed: row => Boolean(row.failure),
  opened: row => Boolean(row.openedAt),
  sent: row => Boolean(row.sentAt),
  unsubscribed: row => Boolean(row.unsubscribed)
};

/**
 * Результаты рассылки по получателям: отправка, ошибка доставки, исключение,
 * отписка, открытие и переход (последние два — у рассылок с отслеживанием).
 * В список входят и адреса, которых уже нет среди получателей (отписались,
 * исключены). ?event= — только адреса с этим событием, ?offset=, ?limit=,
 * ?format=csv — файл со строкой заголовков. Ответ: { summary, total, list }
 */
export function getResults (
  mailingRepository: MailingRepository, failureCounter: FailureCounter
) {
  return catchPromise(async function (req: Request, res: Response) {
    const id = Number(req.params.id);
    if (!(id > 0)) {
      res.status(400).json(error('Invalid ID'));
      return;
    }
    const event = req.query.event;
    if (event !== undefined && !RESULT_EVENTS.includes(event as ResultEvent)) {
      res.status(400).json(error(`event must be one of: ${RESULT_EVENTS.join(', ')}`));
      return;
    }
    const mailing = await mailingRepository.getById(id);
    if (!mailing) {
      res.status(404).json(error('Mailing not found'));
      return;
    }

    const [receivers, failures, sent, unsubscribes, tracking] = await Promise.all([
      mailingRepository.getReceivers(id),
      failureCounter.getFailedReceivers(mailing),
      mailingRepository.getSent(id),
      mailingRepository.getUnsubscribes(id),
      mailingRepository.getTrackingStats(id)
    ]);

    // Сначала получатели в порядке списка, затем адреса, которых в нём нет
    const rows = new Map<string, ReceiverResult>();
    const row = (email: string) => {
      let result = rows.get(email);
      if (!result) {
        result = { email };
        rows.set(email, result);
      }
      return result;
    };
    for (const receiver of receivers) {
      row(receiver.email).name = receiver.name;
    }
    for (const failure of failures) {
      const result = row(failure.email);
      result.failure = {
        date: failure.date, diagnosticCode: failure.diagnosticCode,
        spam: failure.spam, status: failure.status
      };
      if (failure.excluded) {
        result.excluded = true;
      }
    }
    for (const [email, { date, method, name }] of unsubscribes) {
      const result = row(email);
      result.unsubscribed = { date, method };
      result.name = result.name ?? name;
    }
    for (const [email, date] of sent) {
      row(email).sentAt = date;
    }
    for (const [email, date] of tracking.opens) {
      row(email).openedAt = date;
    }
    for (const [email, date] of tracking.clicks) {
      row(email).clickedAt = date;
    }

    const all = [...rows.values()];
    const summary = {
      receivers: receivers.length,
      ...Object.fromEntries(RESULT_EVENTS.map(name => [
        name, all.filter(hasEvent[name]).length
      ]))
    };
    let list = event ? all.filter(hasEvent[event as ResultEvent]) : all;
    const total = list.length;
    const offset = Math.max(0, parseInt(String(req.query.offset ?? 0), 10) || 0);
    const limit = parseInt(String(req.query.limit ?? ''), 10);
    list = list.slice(offset, limit > 0 ? offset + limit : undefined);

    if (req.query.format === 'csv') {
      await serveCsv(res, [CSV_HEADER, ...list.map(toCsvRow)], `results-${id}.csv`);
      return;
    }
    res.json(success({ list, summary, total }));
  });
}

const CSV_HEADER = [
  'email', 'name', 'sentAt', 'status', 'spam', 'diagnosticCode', 'failedAt', 'excluded',
  'unsubscribedAt', 'unsubscribeMethod', 'openedAt', 'clickedAt'
];

function toCsvRow (row: ReceiverResult): string[] {
  return [
    row.email, row.name || '', row.sentAt || '',
    row.failure?.status || '', row.failure?.spam ? 'spam' : '',
    row.failure?.diagnosticCode || '', row.failure?.date || '',
    row.excluded ? 'excluded' : '',
    row.unsubscribed?.date || '', row.unsubscribed?.method || '',
    row.openedAt || '', row.clickedAt || ''
  ];
}
