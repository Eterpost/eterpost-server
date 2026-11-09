import { MailingRepository } from '../MailingRepository';
import { Request, Response } from 'express';
import { error, success } from '../utils/response';
import { MailingState } from '../MailingState';
import { jsonSchemaMiddleware } from '../middleware/jsonSchemaMiddleware';
import { catchPromise } from '../utils/catchPromise';
import { getListId } from '../getListId';
import { Logger } from '../Logger';
import { FailureCounter } from '../FailureCounter';


export function createRetryMailing (
  config: any, mailingRepository: MailingRepository, logger: Logger,
  failureCounter: FailureCounter
) {
  const handler = async function (req: Request, res: Response) {
    const sourceId = req.body.sourceId;
    const sourceMailing = await mailingRepository.getById(sourceId);
    if (!sourceMailing) {
      res.status(404).json(error('Source mailing not found'));
      return;
    }

    const sourceFailedReceivers = await failureCounter.getFailedReceivers(sourceMailing);

    const properties = {
      extraData: sourceMailing.extraData,
      html: sourceMailing.html,
      listUnsubscribe: sourceMailing.listUnsubscribe,
      name: sourceMailing.name + ': повтор по ошибкам доставки',
      openForSubscription: sourceMailing.openForSubscription,
      from: sourceMailing.from,
      replyTo: sourceMailing.replyTo,
      sentCount: 0,
      state: MailingState.NEW,
      subject: sourceMailing.subject,
      undeliveredCount: 0
    };

    // Получатели переносятся целиком (имя, код, расписание, extraData), иначе
    // письмо повтора отличалось бы от исходного. Исключённые mail-sorter адреса
    // не возвращаем: их отсеяли намеренно, в списке рассылки их уже нет
    const sourceReceivers = new Map(
      (await mailingRepository.getReceivers(sourceMailing.id)).map(r => [r.email, r])
    );
    const receivers = sourceFailedReceivers
      .filter(receiver => !receiver.excluded)
      .map(receiver => sourceReceivers.get(receiver.email) || { email: receiver.email });

    const mailing = await mailingRepository.create(properties, receivers);
    logger.info(`Created retry mailing ${properties.name} with ID #${mailing.id}`);

    const listId = getListId(config, mailing);
    await mailingRepository.updateInTransaction(mailing.id, mailingToUpdate => {
      mailingToUpdate.listId = listId;
    });
    logger.verbose(`#${mailing.id}: assigned List-Id = ${listId}`);

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
    sourceId: {
      type: 'number'
    }
  },
  required: [
    'sourceId'
  ]
};
