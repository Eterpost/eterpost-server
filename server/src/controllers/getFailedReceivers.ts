import { Request, Response } from 'express';
import { success } from '../utils/response.js';
import { catchPromise } from '../utils/catchPromise.js';
import { FailureCounter } from '../FailureCounter.js';
import { serveCsv } from '../utils/serveCsv.js';
import { getLoadedMailing } from '../middleware/loadMailing.js';


export function getFailedReceivers (failureCounter: FailureCounter) {
  return catchPromise(async function (req: Request, res: Response) {
    const mailing = getLoadedMailing(res);
    const limit = typeof req.query.limit === 'string' ? parseInt(req.query.limit, 10) : null;
    const csv = req.query.format === 'csv';

    let list = await failureCounter.getFailedReceivers(mailing);
    const total = list.length;
    if (limit) {
      list = list.slice(0, limit);
    }

    if (csv) {
      await serveCsv(res, list.map(receiver => [
        receiver.email, receiver.spam ? 'spam' : receiver.status,
        receiver.diagnosticCode || '<no Diagnostic-Code header>',
        receiver.excluded ? 'excluded' : '', receiver.date || '',
        receiver.mailingId ? String(receiver.mailingId) : ''
      ]), 'failed-receivers.csv');
      return;
    }

    res.json(success({
      list, total
    }));
  });
}
