import { MailingRepository } from '../MailingRepository';
import { Request, Response } from 'express';
import { error, success } from '../utils/response';
import { catchPromise } from '../utils/catchPromise';
import { MailingState } from '../MailingState';
import { getLoadedMailing } from '../middleware/loadMailing';
import { Logger } from '../Logger';
import { AttachmentStore } from '../AttachmentStore';


export function deleteMailing (
  mailingRepository: MailingRepository, logger: Logger, attachmentStore?: AttachmentStore
) {
  return catchPromise(async function (req: Request, res: Response) {
    const mailing = getLoadedMailing(res);

    if (mailing.state === MailingState.RUNNING) {
      res.status(400).json(error('Cannot delete a running mailing'));
      return;
    }

    await mailingRepository.remove(mailing);
    if (mailing.attachments.length) {
      await attachmentStore?.removeAll(mailing.id);
    }
    logger.info(`Deleted mailing #${mailing.id}`);
    res.json(success());
  });
}
