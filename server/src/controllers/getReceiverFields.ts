import { Request, Response } from 'express';
import { success } from '../utils/response.js';
import { catchPromise } from '../utils/catchPromise.js';
import { getLoadedMailing } from '../middleware/loadMailing.js';
import { FieldStatsCollector } from 'eterpost-letter-editor/fields';


/**
 * Сводка по полям всех получателей рассылки: у скольких заполнены имя и каждая
 * своя колонка. Веб-клиент по ней предупреждает о пустых подстановках
 */
export function getReceiverFields () {
  return catchPromise(async function (req: Request, res: Response) {
    const collector = new FieldStatsCollector();
    for await (const receiver of getLoadedMailing(res).getReceiversStream()) {
      collector.add(receiver);
    }
    res.json(success(collector.result()));
  });
}
