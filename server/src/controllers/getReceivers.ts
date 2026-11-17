import { MailingRepository } from '../MailingRepository.js';
import { Request, Response } from 'express';
import { success } from '../utils/response.js';
import { catchPromise } from '../utils/catchPromise.js';
import { serveCsv } from '../utils/serveCsv.js';
import { getLoadedMailing } from '../middleware/loadMailing.js';


export function getReceivers (mailingRepository: MailingRepository) {
  return catchPromise(async function (req: Request, res: Response) {
    const id = getLoadedMailing(res).id;
    const limit = typeof req.query.limit === 'string' ? parseInt(req.query.limit, 10) : null;
    const csv = req.query.format === 'csv';

    const receivers = await mailingRepository.getReceivers(id, 0, limit || -1);

    if (csv) {
      await serveCsv(res, receivers.map(receiver => [receiver.email]), 'receivers.csv');
      return;
    }

    const total = await mailingRepository.getReceiverCount(id);
    const list = receivers.map(receiver => ({
      email: receiver.email,
      name: receiver.name,
      periodicDate: receiver.periodicDate
    }));
    res.json(success({
      list, total
    }));
  });
}
