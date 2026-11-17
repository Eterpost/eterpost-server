import { Request, Response } from 'express';
import { error, success } from '../utils/response.js';
import { catchPromise } from '../utils/catchPromise.js';
import { MailingState } from '../MailingState.js';
import { Logger } from '../Logger.js';
import { getLoadedMailing } from '../middleware/loadMailing.js';


export function deleteReceiver (logger: Logger) {
  return catchPromise(async function (req: Request, res: Response) {
    const mailing = getLoadedMailing(res);
    const receiverId = String(req.params.receiverId);

    if (mailing.state === MailingState.RUNNING) {
      res.status(400).json(error('Cannot delete a receiver from running mailing'));
      return;
    }

    const receiver = await mailing.getReceiverByEmail(receiverId);

    if (!receiver) {
      res.status(404).json(error('Receiver not found'));
      return;
    }

    await mailing.removeReceiver(receiver);

    logger.info(`Deleted receiver ${receiverId} from mailing #${mailing.id}`);
    res.json(success());
  });
}
