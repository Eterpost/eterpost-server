import { MailingRepository } from '../MailingRepository';
import { Request, Response } from 'express';
import { success } from '../utils/response';
import { getLoadedMailing } from '../middleware/loadMailing';
import { catchPromise } from '../utils/catchPromise';
import { describeRetries } from './describeRetries';
import { MailingState } from '../MailingState';
import { getAttachmentsConfig } from '../attachments';


export function getMailing (mailingRepository: MailingRepository, config: any) {
  return catchPromise(async function (req: Request, res: Response) {
    const mailing = getLoadedMailing(res);

    res.json(success({
      attachments: mailing.attachments,
      attachmentsMaxSize: getAttachmentsConfig(config).maxSize,
      creationDate: mailing.creationDate && Math.floor(mailing.creationDate.getTime() / 1000),
      extraData: mailing.extraData,
      html: mailing.html,
      id: mailing.id,
      autoResumeAt: mailing.autoResumeAt ?
        new Date(mailing.autoResumeAt).toISOString() : undefined,
      listId: mailing.listId,
      listUnsubscribe: mailing.listUnsubscribe,
      tracking: mailing.tracking,
      ...(mailing.tracking ? await mailingRepository.getTrackingCounts(mailing.id) : {}),
      name: mailing.name,
      openForSubscription: mailing.openForSubscription,
      from: mailing.from,
      replyTo: mailing.replyTo,
      sentCount: mailing.sentCount,
      ...await describeRetries(mailingRepository, mailing.id),
      state: req.query.stringState ? MailingState[mailing.state] : mailing.state,
      space: mailing.space,
      subject: mailing.subject,
      test: mailing.test,
      undeliveredCount: mailing.undeliveredCount
    }));
  });
}
