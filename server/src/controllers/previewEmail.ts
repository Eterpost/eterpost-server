import { Request, Response } from 'express';
import { success, error } from '../utils/response';
import { jsonSchemaMiddleware } from '../middleware/jsonSchemaMiddleware';
import { catchPromise } from '../utils/catchPromise';
import { MailingExecutor } from '../MailingExecutor';
import { getLoadedMailing } from '../middleware/loadMailing';
import { Receiver } from '../Receiver';
import { ComposedMessage } from '../composeMessage';
import { ExternalContentError, TemplateError } from '../templates/TemplateErrors';


/**
 * Предпросмотр письма получателю без отправки. Если адреса нет в рассылке,
 * письмо собирается для получателя только с адресом — как тестовое
 */
export function previewEmail (executor: MailingExecutor) {
  const handler = async function (req: Request, res: Response) {
    const mailing = getLoadedMailing(res);

    const email: string = req.body.email;
    const found = await mailing.getReceiverByEmail(email);
    const receiver = found || new Receiver(email);
    let message: ComposedMessage;
    try {
      message = await executor.previewEmail(mailing, receiver);
    } catch (err) {
      sendPreviewError(res, err);
      return;
    }

    res.json(success({ ...formatPreview(message, receiver), receiverFound: Boolean(found) }));
  };
  return [jsonSchemaMiddleware(requestBodyJsonSchema), catchPromise(handler)];
}

/**
 * Письмо для ответа API предпросмотра (без вложений)
 */
export function formatPreview (message: ComposedMessage, receiver: Receiver) {
  return {
    from: message.from,
    headers: message.headers,
    html: message.html,
    receiver: { email: receiver.email, name: receiver.name },
    replyTo: message.replyTo,
    sender: message.sender,
    subject: message.subject,
    text: message.text,
    to: message.to
  };
}

/**
 * Ошибка сборки письма: шаблон не собирается — 400 с полем и сообщением
 * Handlebars, внешнее содержимое не получено — 502. Прочие ошибки
 * пробрасываются (500)
 */
export function sendPreviewError (res: Response, err: unknown) {
  if (err instanceof TemplateError) {
    res.status(400).json(error(`${err.field || 'template'}: ${err.message}`, 'TEMPLATE_ERROR'));
  } else if (err instanceof ExternalContentError) {
    res.status(502).json(error(err.message, 'EXTERNAL_CONTENT_ERROR'));
  } else {
    throw err;
  }
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
