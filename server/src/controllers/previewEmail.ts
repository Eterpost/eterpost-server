import { MailingRepository } from '../MailingRepository';
import { Request, Response } from 'express';
import { success, error } from '../utils/response';
import { jsonSchemaMiddleware } from '../middleware/jsonSchemaMiddleware';
import { catchPromise } from '../utils/catchPromise';
import { MailingExecutor } from '../MailingExecutor';
import { Receiver } from '../Receiver';


/**
 * Предпросмотр письма получателю без отправки. Если адреса нет в рассылке,
 * письмо собирается для получателя только с адресом — как тестовое
 */
export function previewEmail (mailingRepository: MailingRepository, executor: MailingExecutor) {
  const handler = async function (req: Request, res: Response) {
    const id = Number(req.params.id);

    if (!(id > 0)) {
      res.status(400).json(error('Invalid ID'));
      return;
    }

    const mailing = await mailingRepository.getById(id);

    if (!mailing) {
      res.status(404).json(error('Mailing not found'));
      return;
    }

    const email: string = req.body.email;
    const found = await mailing.getReceiverByEmail(email);
    const receiver = found || new Receiver(email);
    const message = await executor.previewEmail(mailing, receiver);

    res.json(success({
      from: message.from,
      headers: message.headers,
      html: message.html,
      receiver: { email: receiver.email, name: receiver.name },
      receiverFound: Boolean(found),
      replyTo: message.replyTo,
      sender: message.sender,
      subject: message.subject,
      text: message.text,
      to: message.to
    }));
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
    }
  },
  required: [
    'email'
  ]
};
