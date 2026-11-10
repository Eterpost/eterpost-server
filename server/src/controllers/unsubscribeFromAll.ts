import { MailingRepository } from '../MailingRepository';
import { Request, Response } from 'express';
import { error, success } from '../utils/response';
import { jsonSchemaMiddleware } from '../middleware/jsonSchemaMiddleware';
import { catchPromise } from '../utils/catchPromise';
import { getSpaceAccess } from '../middleware/spaceAccess';
import { Logger } from '../Logger';


/**
 * Исключает адрес из всех рассылок без проверки кода. Используется
 * mail-sorter (драйвер базы "mail-server") для адресов, на которые письма
 * не доставляются, и для запросов отписки, пришедших письмом. С listUnsubscribe: true
 * адрес исключается только из рассылок с заголовком List-Unsubscribe: письмо на
 * адрес из этого заголовка — отписка от них, а не от всех рассылок.
 * С mailingId (номер из адреса отписки) и найденной рассылкой адрес исключается
 * только из рассылок её пространства; без него или с несуществующей — из всех.
 * Доступен только служебному (и старому без роли) ключу.
 * Ответ: { removed: <количество рассылок, из которых удалён адрес> }
 */
export function unsubscribeFromAll (mailingRepository: MailingRepository, logger: Logger) {
  const handler = async function (req: Request, res: Response) {
    const access = getSpaceAccess(res);
    if (!access.system && !access.legacy) {
      res.status(403).json(
        error('Only a system key may unsubscribe from all mailings', 'FORBIDDEN')
      );
      return;
    }
    const email: string = req.body.email;
    const scope = req.body.mailingId === undefined
      ? undefined : (await mailingRepository.getById(req.body.mailingId))?.space;
    let removed = 0;
    for (const mailing of await mailingRepository.getAll()) {
      if (scope !== undefined && mailing.space !== scope) {
        continue;
      }
      if (req.body.listUnsubscribe && !mailing.listUnsubscribe) {
        continue;
      }
      const receiver = await mailing.getReceiverByEmail(email);
      // Без listUnsubscribe адрес исключается из-за ошибок доставки: он остаётся
      // в отчёте об ошибках рассылки
      if (receiver && await mailing.removeReceiver(receiver, !req.body.listUnsubscribe)) {
        // С listUnsubscribe это отписка письмом (mail-sorter), иначе исключение
        if (req.body.listUnsubscribe) {
          await mailingRepository.recordUnsubscribe(mailing.id, {
            date: new Date().toISOString(), email, method: 'mail', name: receiver.name
          });
        }
        logger.info(`Unsubscribed: mailing #${mailing.id}, email ${email}`);
        removed++;
      }
    }
    res.json(success({ removed }));
  };
  return [jsonSchemaMiddleware(requestBodyJsonSchema), catchPromise(handler)];
}

export const requestBodyJsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    email: {
      type: 'string',
      minLength: 1
    },
    listUnsubscribe: {
      type: 'boolean'
    },
    mailingId: {
      minimum: 1,
      type: 'integer'
    }
  },
  required: [
    'email'
  ]
};
