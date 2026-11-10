import { MailingRepository } from '../MailingRepository';
import { Request, Response } from 'express';
import { error, success } from '../utils/response';
import { MailingState } from '../MailingState';
import { jsonSchemaMiddleware } from '../middleware/jsonSchemaMiddleware';
import { catchPromise } from '../utils/catchPromise';
import { getListId } from '../getListId';
import { Logger } from '../Logger';
import { FailedReceiver, FailureCounter } from '../FailureCounter';
import { canSee, getSpaceAccess } from '../middleware/spaceAccess';
import { AttachmentStore } from '../AttachmentStore';
import { attachFiles } from './attachments';


/**
 * Какие ошибки доставки повторять: только отказы как спам, только адреса
 * из этих доменов, только временные ('4') или постоянные ('5') ошибки
 */
export interface RetryFilter {
  domains?: string[];
  spam?: boolean;
  status?: '4' | '5';
}

export function matchesRetryFilter (receiver: FailedReceiver, filter: RetryFilter = {}) {
  if (filter.spam && !receiver.spam) {
    return false;
  }
  if (filter.status && !(receiver.status || '').startsWith(filter.status)) {
    return false;
  }
  if (filter.domains && filter.domains.length) {
    const domain = receiver.email.slice(receiver.email.lastIndexOf('@') + 1).toLowerCase();
    if (!filter.domains.some(item => item.trim().toLowerCase() === domain)) {
      return false;
    }
  }
  return true;
}


export function createRetryMailing (
  config: any, mailingRepository: MailingRepository, logger: Logger,
  failureCounter: FailureCounter, attachmentStore?: AttachmentStore
) {
  const handler = async function (req: Request, res: Response) {
    const sourceId = req.body.sourceId;
    const sourceMailing = await mailingRepository.getById(sourceId);
    if (!sourceMailing || !canSee(getSpaceAccess(res), sourceMailing.space)) {
      res.status(404).json(error('Source mailing not found'));
      return;
    }

    // Исключённые mail-sorter адреса не возвращаем: их отсеяли намеренно
    const sourceFailedReceivers = (await failureCounter.getFailedReceivers(sourceMailing))
      .filter(receiver => !receiver.excluded && matchesRetryFilter(receiver, req.body.filter));
    // dryRun — только посчитать, сколько адресов попадёт в повтор
    if (req.body.dryRun) {
      res.json(success({ count: sourceFailedReceivers.length }));
      return;
    }
    if (sourceMailing.attachments.length && !attachmentStore?.available) {
      res.status(503).json(error('Attachments are unavailable', 'ATTACHMENTS_UNAVAILABLE'));
      return;
    }

    const properties = {
      extraData: sourceMailing.extraData,
      html: sourceMailing.html,
      listUnsubscribe: sourceMailing.listUnsubscribe,
      tracking: sourceMailing.tracking,
      name: sourceMailing.name + ': повтор по ошибкам доставки',
      openForSubscription: sourceMailing.openForSubscription,
      from: sourceMailing.from,
      replyTo: sourceMailing.replyTo,
      sentCount: 0,
      // Повтор — в пространстве исходной рассылки
      space: sourceMailing.space,
      state: MailingState.NEW,
      subject: sourceMailing.subject,
      test: sourceMailing.test,
      undeliveredCount: 0
    };

    // Получатели переносятся целиком (имя, код, расписание, extraData), иначе
    // письмо повтора отличалось бы от исходного
    const sourceReceivers = new Map(
      (await mailingRepository.getReceivers(sourceMailing.id)).map(r => [r.email, r])
    );
    const receivers = sourceFailedReceivers
      .map(receiver => sourceReceivers.get(receiver.email) || { email: receiver.email });

    const mailing = await mailingRepository.create(properties, receivers);
    logger.info(`Created retry mailing ${properties.name} with ID #${mailing.id}`);

    const listId = getListId(config, mailing);
    await mailingRepository.updateInTransaction(mailing.id, mailingToUpdate => {
      mailingToUpdate.listId = listId;
    });
    logger.verbose(`#${mailing.id}: assigned List-Id = ${listId}`);

    if (sourceMailing.attachments.length) {
      await attachFiles(
        mailingRepository, attachmentStore!, mailing, [], sourceMailing.id,
        sourceMailing.attachments
      );
    }

    res.json(success({
      id: mailing.id, listId
    }));
  };
  return [jsonSchemaMiddleware(requestBodyJsonSchema), catchPromise(handler)];
}

export const requestBodyJsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    dryRun: {
      type: 'boolean',
      description: 'Только посчитать адреса (ответ { count }), рассылку не создавать'
    },
    filter: {
      type: 'object',
      additionalProperties: false,
      description: 'Какие ошибки повторять; без фильтра — все, кроме исключённых адресов',
      properties: {
        domains: {
          type: 'array',
          items: { type: 'string', minLength: 1 },
          description: 'Только адреса из этих доменов, например ["mail.ru", "list.ru"]'
        },
        spam: {
          type: 'boolean',
          description: 'Только отказы как спам'
        },
        status: {
          enum: ['4', '5'],
          description: '4 — только временные ошибки (4.x.x), 5 — только постоянные (5.x.x)'
        }
      }
    },
    sourceId: {
      type: 'number'
    }
  },
  required: [
    'sourceId'
  ]
};
