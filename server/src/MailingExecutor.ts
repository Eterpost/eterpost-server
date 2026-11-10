import { Mailing } from './Mailing';
import { MailingState } from './MailingState';
import { MailSender } from './MailSender';
import { Receiver } from './Receiver';
import { Email, Headers } from './Email';
import { EventEmitter } from 'events';
import { MailingRepository } from './MailingRepository';
import { Logger } from './Logger';
import { AddressStatsRepository } from './AddressStatsRepository';
import { AddressStatsProperties } from './AddressStats';
import { isEmail } from 'validator';
import { sleep } from './utils/sleep';
import { ComposedMessage, composeMessage, htmlToText } from './composeMessage';
import { applyTracking, createTrackingToken } from './tracking';
import { createSpamDetector } from './spamDetection';
import { SpaceRepository } from './SpaceRepository';
import { AttachmentStore } from './AttachmentStore';


// Паузы перед повторами при временной ошибке SMTP (секунды), если не заданы
// в server.sendRetryDelays
const DEFAULT_SEND_RETRY_DELAYS = [10, 60, 300];
// Паузы (секунды) перед повторами получателю, которому сервер временно отказал
// на RCPT TO (4xx), если не заданы в server.rcptRetryDelays. Так релей успевает
// проверить адрес (reject_unverified_recipient) или снять greylisting
const DEFAULT_RCPT_RETRY_DELAYS = [60, 300, 900, 3600];

/**
 * Файл вложения рассылки пропал с диска: письмо без него не отправляется
 */
export class MissingAttachmentError extends Error {
  constructor (public filename: string) {
    super(`Attachment file is missing: ${filename}`);
    this.name = 'MissingAttachmentError';
  }
}

export class MailingExecutor extends EventEmitter {
  private executionStates: Map<number, MailingExecutionState> = new Map();
  private isSpam: (response?: string) => boolean;

  constructor (
    private mailer: MailSender,
    private mailingRepository: MailingRepository,
    private addressStatsRepository: AddressStatsRepository,
    private spaceRepository: SpaceRepository,
    private logger: Logger,
    private config: any,
    private attachmentStore?: AttachmentStore
  ) {
    super();
    this.isSpam = createSpamDetector(config.server.spamPatterns);
  }

  async pauseExecution (mailing: Mailing): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      if (mailing.state !== MailingState.RUNNING || !this.executionStates.has(mailing.id)) {
        this.logger.warn(
          `#${mailing.id}: call to MailingExecutor.pauseExecution while not running`
        );
        resolve();
        return;
      }
      this.logger.verbose(`#${mailing.id}: stop requested`);
      this.once(MailingExecutorEvents.MAILING_PAUSED, resolve);
      const state = this.executionStates.get(mailing.id);
      if (state) {
        state.stopping = true;
      }
    });
  }

  /**
   * Письмо получателю так, как его соберёт отправка, но без отправки: тема,
   * HTML и текстовая версия, заголовки
   */
  async previewEmail (mailing: Mailing, receiver: Receiver): Promise<ComposedMessage> {
    const email = await this.createEmail(mailing, receiver);
    return composeMessage(email, this.config.server.mail.from);
  }

  /**
   * Все ли файлы вложений рассылки на месте; нет — MissingAttachmentError
   */
  async checkAttachments (mailing: Mailing): Promise<void> {
    for (const attachment of mailing.attachments) {
      if (!await this.attachmentStore?.exists(mailing.id, attachment.id)) {
        throw new MissingAttachmentError(attachment.filename);
      }
    }
  }

  async sendTestEmail (mailing: Mailing, address: string) {
    await this.checkAttachments(mailing);
    const email = await this.createEmail(mailing, new Receiver(address));
    await this.mailer.sendEmail(email);
    this.logger.verbose(`#${mailing.id}: sent test email to ${address}`);
  }

  async startExecution (mailing: Mailing): Promise<void> {
    if (mailing.state === MailingState.RUNNING) { return; }

    if (mailing.state === MailingState.FINISHED) {
      this.logger.verbose(`#${mailing.id}: reset sentCount and position`);
      await this.mailingRepository.clearRetries(mailing.id);
      mailing = await this.mailingRepository.updateInTransaction(mailing.id, mailingToUpdate => {
        mailingToUpdate.position = 0;
        mailingToUpdate.sentCount = 0;
      }) || mailing;
    }

    const { value: receiver } = await this.getActualReceiverStream(mailing).next();
    if (!receiver && !(await this.mailingRepository.getRetries(mailing.id)).length) {
      this.logger.debug(`#${mailing.id}: no receivers to send emails to, ignoring start request`);
      return;
    }

    // Без файла вложения рассылка не уходит: ошибка переводит её в ERROR
    try {
      await this.checkAttachments(mailing);
    } catch (error) {
      this.logger.error(`#${mailing.id}: ${(error as Error).message}`);
      this.emit(MailingExecutorEvents.MAILING_ERROR, mailing.id, error);
      return;
    }

    this.logger.debug(`#${mailing.id}: starting execution`);

    this.executionStates.set(mailing.id, { stopping: false });
    this.emit(MailingExecutorEvents.MAILING_STARTED, mailing.id);
    // Это не ошибка - не ждём через await намеренно, пусть выполняется в фоне
    this.runMailing(mailing).catch(error => {
      this.emit(MailingExecutorEvents.MAILING_ERROR, mailing.id, error);
    });
  }

  private async *getActualReceiverStream (mailing: Mailing) {
    const startedAt = new Date();
    for await (const receiver of mailing.getUnsentReceiversStream()) {
      if (this.checkReceiver(mailing, receiver, startedAt)) {
        yield receiver;
      }
    }
  }

  private checkReceiver (mailing: Mailing, receiver: Receiver, startedAt: Date) {
    if (!isEmail(receiver.email) || receiver.email[0] === '-') {
      this.logger.warn(`#${mailing.id}: dropping non-email ${receiver.email}`);
      return false;
    }

    return receiver.shouldSendAt(startedAt);
  }

  /**
   * track — настоящая отправка: у рассылки с отслеживанием ссылки оборачиваются
   * и добавляется счётчик открытия. Предпросмотр и пробное письмо собираются
   * без отслеживания: ссылки в них ведут прямо на место, открытия не считаются
   */
  private async createEmail (mailing: Mailing, receiver: Receiver, track = false) {
    const headers: Headers = {};
    if (mailing.listId) {
      headers['List-Id'] = mailing.listId;
    }
    if (mailing.listUnsubscribe && this.config.server.mail.listUnsubscribe) {
      // {id} — номер рассылки: по нему mail-sorter определяет пространство отписки
      headers['List-Unsubscribe'] =
        this.config.server.mail.listUnsubscribe.replaceAll('{id}', String(mailing.id));
    }
    headers.Precedence = 'bulk';
    let html = await mailing.getHtmlForReceiver(receiver);
    let text: string | undefined;
    const trackingUrl: string | undefined = this.config.server.tracking?.url;
    if (track && mailing.tracking && trackingUrl) {
      const token = createTrackingToken();
      // Страницы подписки и отписки (facade) не оборачиваются
      const skip = [trackingUrl, this.config.server.subscription?.url].filter(Boolean);
      const tracked = applyTracking(html, trackingUrl, mailing.id, token, skip);
      await this.mailingRepository.setTrackedLetter(mailing.id, token, {
        email: receiver.email, links: tracked.links
      });
      // В текстовой версии — исходные ссылки
      text = htmlToText(html);
      html = tracked.html;
    }
    const subject = await mailing.getSubjectForReceiver(receiver);
    // From: адрес рассылки, иначе адрес пространства; если и его нет — composeMessage
    // подставит server.mail.from
    const from = mailing.from || (await this.spaceRepository.get(mailing.space))?.from;
    return new Email({
      attachments: mailing.attachments.length ? mailing.attachments.map(attachment => ({
        contentType: attachment.contentType,
        filename: attachment.filename,
        path: this.attachmentStore!.path(mailing.id, attachment.id)
      })) : undefined,
      from,
      headers,
      html: html,
      text,
      receivers: [receiver],
      replyTo: mailing.replyTo,
      subject
    });
  }

  private isStopping (mailingId: number): boolean {
    const state = this.executionStates.get(mailingId);
    return Boolean(state && state.stopping);
  }

  private async runMailing (generalInfoMailing: Mailing): Promise<void> {
    // generalInfoMailing - объект с общей информацией о рассылке.
    // Он может быть устаревшим, поэтому его не обновляем напрямую.
    // Позиция в списке получателей хранится в репозитории и читается перед
    // каждым письмом: список может измениться во время отправки (mail-sorter
    // удаляет адреса с ошибками доставки), и репозиторий поправляет позицию

    const mailingId = generalInfoMailing.id;
    const startedAt = new Date();
    while (true) {
      if (this.isStopping(mailingId)) {
        this.logger.debug(`#${mailingId}: execution was stopped, exiting`);
        this.executionStates.delete(mailingId);
        this.emit(MailingExecutorEvents.MAILING_PAUSED, mailingId);
        return;
      }

      const receiver = await this.mailingRepository.getNextReceiver(mailingId);
      if (!receiver) {
        break;
      }

      if (!this.checkReceiver(generalInfoMailing, receiver, startedAt)) {
        await this.mailingRepository.advancePosition(mailingId, receiver, false);
        continue;
      }

      const email = await this.createEmail(generalInfoMailing, receiver, true);
      this.logger.debug(`#${mailingId}: sending email to ${email.receivers.join(',')}`);
      this.logger.debug(`${receiver.email}: periodicDate = ${receiver.periodicDate}`);
      const { result, error } = await this.sendWithRetry(mailingId, email);
      if (result === SendResult.STOPPED) {
        continue;
      }
      if (result === SendResult.REJECTED) {
        await this.handleRejection(mailingId, email, error, 0);
        await this.mailingRepository.advancePosition(mailingId, receiver, false);
        continue;
      }
      this.logger.verbose(`#${mailingId}: sent to ${email.receivers.join(',')}`);
      await this.mailingRepository.advancePosition(mailingId, receiver, true);
      await this.handleSent(generalInfoMailing, email);
    }

    if (!await this.runRcptRetries(generalInfoMailing)) {
      this.logger.debug(`#${mailingId}: execution was stopped while retrying, exiting`);
      this.executionStates.delete(mailingId);
      this.emit(MailingExecutorEvents.MAILING_PAUSED, mailingId);
      return;
    }

    this.executionStates.delete(mailingId);
    this.emit(MailingExecutorEvents.MAILING_FINISHED, mailingId);
  }

  private async handleSent (mailing: Mailing, email: Email) {
    this.emit(MailingExecutorEvents.EMAIL_SENT, mailing, email);

    // TODO: думаю, что это стоит вынести в отдельный класс-наблюдатель,
    // чтобы подсчёт статистики работал по событию отправки письма
    const date = new Date();
    for (const address of email.receivers) {
      await this.updateAddressStats(address.email);
      await this.mailingRepository.recordSent(mailing.id, address.email, date);
    }
  }

  /**
   * Повторы получателям, которым сервер временно отказал на RCPT TO, после
   * основного прохода: каждому — после своей паузы из rcptRetryDelays. Список
   * повторов хранится в репозитории, поэтому переживает паузу и перезапуск.
   * false, если за это время запросили остановку рассылки
   */
  private async runRcptRetries (mailing: Mailing): Promise<boolean> {
    const mailingId = mailing.id;
    while (true) {
      if (this.isStopping(mailingId)) {
        return false;
      }
      const retries = await this.mailingRepository.getRetries(mailingId);
      if (!retries.length) {
        return true;
      }
      const now = Date.now();
      const due = retries.filter(retry => retry.nextAt <= now);
      if (!due.length) {
        this.logger.debug(`#${mailingId}: ${retries.length} receivers wait for a retry`);
        if (!await this.waitUnlessStopping(mailingId, retries[0].nextAt - now)) {
          return false;
        }
        continue;
      }

      // Список мог измениться: удалённым из рассылки (отписка) повтор не нужен
      const receivers = new Map(
        (await this.mailingRepository.getReceivers(mailingId)).map(r => [r.email, r])
      );
      for (const retry of due) {
        if (this.isStopping(mailingId)) {
          return false;
        }
        const receiver = receivers.get(retry.email);
        if (!receiver) {
          this.logger.verbose(`#${mailingId}: ${retry.email} left the mailing, no retry`);
          await this.mailingRepository.removeRetry(mailingId, retry.email);
          continue;
        }
        const email = await this.createEmail(mailing, receiver, true);
        this.logger.debug(`#${mailingId}: retry ${retry.attempts + 1} to ${retry.email}`);
        const { result, error } = await this.sendWithRetry(mailingId, email);
        if (result === SendResult.STOPPED) {
          return false;
        }
        if (result === SendResult.REJECTED) {
          await this.handleRejection(mailingId, email, error, retry.attempts + 1);
          continue;
        }
        this.logger.verbose(
          `#${mailingId}: sent to ${retry.email} on retry ${retry.attempts + 1}`
        );
        await this.mailingRepository.removeRetry(mailingId, retry.email);
        await this.mailingRepository.updateInTransaction(mailingId, mailingToUpdate => {
          mailingToUpdate.sentCount++;
        });
        await this.handleSent(mailing, email);
      }
    }
  }

  /**
   * Отказ на RCPT TO: временный (4xx) откладывается до повтора, пока попытки
   * из rcptRetryDelays не кончились (attempts — сколько повторов уже было);
   * иначе записывается в статистику адреса как ошибка доставки
   */
  private async handleRejection (mailingId: number, email: Email, error: any, attempts: number) {
    const temporary = error.responseCode < 500;
    const delays: number[] = this.config.server.rcptRetryDelays || DEFAULT_RCPT_RETRY_DELAYS;
    const response = String(error.response || error.message);
    if (temporary && attempts < delays.length) {
      this.logger.warn(
        `#${mailingId}: ${email.receivers.join(',')} rejected temporarily, ` +
        `retry in ${delays[attempts]} s: ${response}`
      );
      for (const { email: address } of email.receivers) {
        await this.mailingRepository.setRetry(mailingId, {
          attempts, email: address, nextAt: Date.now() + delays[attempts] * 1000, response
        });
      }
      return;
    }
    await this.recordRejection(mailingId, email, error, temporary);
    for (const { email: address } of email.receivers) {
      await this.mailingRepository.removeRetry(mailingId, address);
    }
  }

  /**
   * Отправляет письмо. Отказ сервера принять получателя (RCPT TO) касается
   * только этого адреса: результат REJECTED, и рассылка идёт дальше (см.
   * handleRejection). Многие релеи проверяют адрес сразу и отказывают на
   * RCPT TO, тогда уведомления о недоставке (DSN) для mail-sorter не будет.
   * Остальные временные ошибки (4xx на MAIL FROM или DATA, сбои соединения)
   * повторяются с паузами.
   * Прочие ошибки касаются всего письма, а не адреса: они выбрасываются и
   * останавливают рассылку — позиция не сдвигается, и после повторного
   * запуска отправка продолжится с этого получателя.
   */
  private async sendWithRetry (
    mailingId: number, email: Email
  ): Promise<{ error?: any, result: SendResult }> {
    const delays: number[] = this.config.server.sendRetryDelays || DEFAULT_SEND_RETRY_DELAYS;
    for (let attempt = 0; ; attempt++) {
      try {
        await this.mailer.sendEmail(email);
        return { result: SendResult.SENT };
      } catch (error: any) {
        const code = error && error.responseCode;
        if (code >= 400 && error.command === 'RCPT TO') {
          return { error, result: SendResult.REJECTED };
        }
        if (code >= 500 || attempt >= delays.length) {
          throw error;
        }
        this.logger.warn(
          `#${mailingId}: temporary error sending to ${email.receivers.join(',')}, ` +
          `retry in ${delays[attempt]} s: ${error && error.message}`
        );
        if (!await this.waitUnlessStopping(mailingId, delays[attempt] * 1000)) {
          return { result: SendResult.STOPPED };
        }
      }
    }
  }

  private async recordRejection (
    mailingId: number, email: Email, error: any, temporary: boolean
  ) {
    const response = String(error.response || error.message);
    // Расширенный код из ответа (550 5.1.1 ...), иначе — класс кода ответа
    const match = /\b([245]\.\d{1,3}\.\d{1,3})\b/.exec(response);
    const status = match ? match[1] : `${Math.floor(error.responseCode / 100)}.0.0`;
    this.logger.warn(
      `#${mailingId}: ${email.receivers.join(',')} rejected` +
      `${temporary ? ' temporarily' : ''}: ${response}`
    );
    for (const { email: address } of email.receivers) {
      // Временные отказы считаются, как у mail-sorter (maxTemporaryFailures)
      const update = (stats: AddressStatsProperties) => {
        stats.diagnosticCode = response;
        stats.lastMailingId = mailingId;
        stats.lastStatus = status;
        stats.lastStatusDate = new Date();
        stats.spam = this.isSpam(response);
        if (temporary) {
          stats.temporaryFailureCount = (stats.temporaryFailureCount || 0) + 1;
        }
      };
      const existingStats = await this.addressStatsRepository.updateInTransaction(
        address, async stats => update(stats)
      );
      if (!existingStats) {
        const stats: AddressStatsProperties = { email: address };
        update(stats);
        await this.addressStatsRepository.create(stats);
      }
      await this.mailingRepository.setFailure(mailingId, {
        date: new Date().toISOString(),
        diagnosticCode: response,
        email: address,
        spam: this.isSpam(response),
        status
      });
    }
    await this.mailingRepository.updateInTransaction(mailingId, mailing => {
      mailing.undeliveredCount++;
    });
  }

  // false, если за время ожидания запросили остановку рассылки
  private async waitUnlessStopping (mailingId: number, ms: number): Promise<boolean> {
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) {
      if (this.isStopping(mailingId)) {
        return false;
      }
      await sleep(Math.min(1000, deadline - Date.now()));
    }
    return !this.isStopping(mailingId);
  }

  private async updateAddressStats (email: string) {
    const existingStats = await this.addressStatsRepository.updateInTransaction(
      email,
      async stats => {
        stats.lastSendDate = new Date();
        stats.sentCount = (stats.sentCount || 0) + 1;
      }
    );
    if (!existingStats) {
      await this.addressStatsRepository.create({
        email,
        lastSendDate: new Date(),
        sentCount: 1
      });
    }
  }
}

export enum MailingExecutorEvents {
  MAILING_ERROR = 'error',
  MAILING_FINISHED = 'finished',
  MAILING_PAUSED = 'paused',
  MAILING_STARTED = 'started',
  EMAIL_SENT = 'sent'
}

enum SendResult {
  SENT,
  REJECTED,
  STOPPED
}

interface MailingExecutionState {
  stopping: boolean;
}
