import { Request, Response } from 'express';
import { success } from '../utils/response';
import { jsonSchemaMiddleware } from '../middleware/jsonSchemaMiddleware';
import { catchPromise } from '../utils/catchPromise';
import { Logger } from '../Logger';
import { MailingExecutor } from '../MailingExecutor';
import { getLoadedMailing } from '../middleware/loadMailing';
import { sendMissingAttachment } from './attachments';
import { Receiver } from '../Receiver';


/**
 * Пробное письмо на адрес email. Если указан receiver — адрес получателя
 * рассылки, шаблоны заполняются его данными (как в предпросмотре), но письмо
 * уходит только на email. Адреса нет в рассылке — шаблоны заполняются только
 * адресом (`receiverFound: false`)
 */
export function sendTestEmail (executor: MailingExecutor, logger: Logger) {
  const handler = async function (req: Request, res: Response) {
    const mailing = getLoadedMailing(res);

    const receiverEmail: string | undefined = req.body.receiver;
    let receiver: Receiver | undefined;
    let receiverFound: boolean | undefined;
    if (receiverEmail) {
      const found = await mailing.getReceiverByEmail(receiverEmail);
      receiverFound = Boolean(found);
      receiver = found || new Receiver(receiverEmail);
    }

    try {
      await executor.sendTestEmail(mailing, req.body.email, receiver);
    } catch (err) {
      if (sendMissingAttachment(res, err)) {
        return;
      }
      throw err;
    }

    res.json(success(receiverEmail ? { receiverFound } : undefined));
  };
  return [jsonSchemaMiddleware(requestBodyJsonSchema), catchPromise(handler)];
}

export const requestBodyJsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    email: {
      format: 'email',
      type: 'string'
    },
    receiver: {
      format: 'email',
      type: 'string'
    }
  },
  required: [
    'email'
  ]
};
