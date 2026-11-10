import { Request, Response } from 'express';
import { success } from '../utils/response';
import { catchPromise } from '../utils/catchPromise';
import { FailureCounter } from '../FailureCounter';
import { serveCsv } from '../utils/serveCsv';
import { getLoadedMailing } from '../middleware/loadMailing';


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
