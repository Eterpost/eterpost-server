import { Request, Response } from 'express';
import { MailingRepository } from '../MailingRepository.js';
import { AddressStatsRepository } from '../AddressStatsRepository.js';
import { success } from '../utils/response.js';
import { jsonSchemaMiddleware } from '../middleware/jsonSchemaMiddleware.js';
import { catchPromise } from '../utils/catchPromise.js';
import { Logger } from '../Logger.js';
import { getLoadedMailing } from '../middleware/loadMailing.js';


/**
 * Возвращает в рассылку адреса, исключённые из-за ошибок доставки: все или
 * только emails. Ошибки в статистике адреса сбрасываются, иначе адрес снова
 * отбросило бы при создании рассылок. Ответ: { restored: [адреса] }
 */
export function restoreExcluded (
  mailingRepository: MailingRepository, statsRepository: AddressStatsRepository, logger: Logger
) {
  const handler = async function (req: Request, res: Response) {
    const id = getLoadedMailing(res).id;

    const restored = await mailingRepository.restoreExcluded(id, req.body.emails);
    for (const email of restored) {
      await statsRepository.updateInTransaction(email, async stats => {
        stats.diagnosticCode = undefined;
        stats.lastStatus = undefined;
        stats.lastStatusDate = undefined;
        stats.spam = false;
        stats.temporaryFailureCount = 0;
      });
    }
    if (restored.length) {
      logger.info(`#${id}: restored excluded receivers ${restored.join(', ')}`);
    }
    res.json(success({ restored }));
  };
  return [jsonSchemaMiddleware(requestBodyJsonSchema), catchPromise(handler)];
}

export const requestBodyJsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    emails: {
      type: 'array',
      items: {
        type: 'string'
      },
      description: 'Какие адреса вернуть; без поля — все исключённые'
    }
  }
};
