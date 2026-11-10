import { Request, Response } from 'express';
import { error, success } from '../utils/response';
import { catchPromise } from '../utils/catchPromise';
import { MailingState } from '../MailingState';
import { Logger } from '../Logger';
import { getLoadedMailing } from '../middleware/loadMailing';


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
