import { MailingRepository } from '../MailingRepository.js';
import { Request, Response } from 'express';
import { error, success } from '../utils/response.js';
import { catchPromise } from '../utils/catchPromise.js';
import { MailingState } from '../MailingState.js';
import { getLoadedMailing } from '../middleware/loadMailing.js';
import { Logger } from '../Logger.js';
import { AttachmentStore } from '../AttachmentStore.js';


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
