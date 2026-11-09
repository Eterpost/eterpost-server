import { Request, Response } from 'express';
import { success } from '../utils/response';
import { jsonSchemaMiddleware } from '../middleware/jsonSchemaMiddleware';
import { catchPromise } from '../utils/catchPromise';
import { MailingExecutor } from '../MailingExecutor';
import { Mailing } from '../Mailing';
import { Receiver } from '../Receiver';
import { getListId } from '../getListId';
import { generateUniqueCode } from '../utils/codes';
import { formatPreview, sendPreviewError } from './previewEmail';


const MAX_RECEIVERS = 100;

/**
 * Предпросмотр письма без созданной рассылки: письмо собирается из
 * переданных полей тем же кодом, что при отправке, ничего не сохраняется
 * и не отправляется. Ответ — письма в порядке receivers
 */
export function previewDraft (config: any, executor: MailingExecutor) {
  const handler = async function (req: Request, res: Response) {
    const body = req.body;
    // Рассылка не сохраняется: номер 0, репозиторий не нужен
    const mailing = new Mailing(0, {
      extraData: body.extraData,
      from: body.from,
      html: body.html,
      listUnsubscribe: body.listUnsubscribe,
      name: body.name || '',
      openForSubscription: body.openForSubscription,
      replyTo: body.replyTo,
      subject: body.subject,
      undeliveredCount: 0
    }, null as any);
    mailing.listId = getListId(config, mailing);

    const letters = [];
    for (const item of body.receivers) {
      // Код получателя нужен для ссылок отписки; при создании рассылки,
      // открытой для подписки, он выдаётся так же
      const code = item.code || (mailing.openForSubscription ? generateUniqueCode() : undefined);
      const receiver = new Receiver(item.email, item.name, code, undefined, item.extraData);
      try {
        letters.push(formatPreview(await executor.previewEmail(mailing, receiver), receiver));
      } catch (err) {
        sendPreviewError(res, err);
        return;
      }
    }
    res.json(success(letters));
  };
  return [jsonSchemaMiddleware(requestBodyJsonSchema), catchPromise(handler)];
}

export const requestBodyJsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    extraData: {
      type: 'object'
    },
    from: {
      type: 'string',
      minLength: 1
    },
    html: {
      type: 'string',
      minLength: 1
    },
    listUnsubscribe: {
      type: 'boolean'
    },
    name: {
      type: 'string'
    },
    openForSubscription: {
      type: 'boolean'
    },
    receivers: {
      type: 'array',
      minItems: 1,
      maxItems: MAX_RECEIVERS,
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          code: {
            type: 'string'
          },
          email: {
            format: 'email',
            type: 'string'
          },
          extraData: {
            type: 'object'
          },
          name: {
            type: 'string'
          }
        },
        required: ['email']
      }
    },
    replyTo: {
      type: 'string',
      minLength: 1
    },
    subject: {
      type: 'string',
      minLength: 1
    }
  },
  required: ['html', 'receivers', 'subject']
};
