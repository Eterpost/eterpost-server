import { MailingRepository } from '../MailingRepository';
import { Request, Response } from 'express';
import { error, success } from '../utils/response';
import { catchPromise } from '../utils/catchPromise';
import { describeRetries } from './describeRetries';
import { canSee, getSpaceAccess } from '../middleware/spaceAccess';


export const MAILING_KINDS = ['live', 'test', 'all'] as const;
type MailingKind = typeof MAILING_KINDS[number];

/**
 * Рассылки текущего пространства; ?kind=live — только боевые, test — только
 * пробные, all (по умолчанию) — все
 */
export function getMailings (mailingRepository: MailingRepository) {
  return catchPromise(async function (req: Request, res: Response) {
    const kind = req.query.kind ?? 'all';
    if (!MAILING_KINDS.includes(kind as MailingKind)) {
      res.status(400).json(error(`kind must be one of: ${MAILING_KINDS.join(', ')}`));
      return;
    }
    const access = getSpaceAccess(res);
    const mailings = (await mailingRepository.getAll()).filter(mailing =>
      canSee(access, mailing.space) && (kind === 'all' || mailing.test === (kind === 'test'))
    );
    const list = await Promise.all(mailings.map(async mailing => ({
      id: mailing.id,
      autoResumeAt: mailing.autoResumeAt ?
        new Date(mailing.autoResumeAt).toISOString() : undefined,
      listId: mailing.listId,
      listUnsubscribe: mailing.listUnsubscribe,
      tracking: mailing.tracking,
      name: mailing.name,
      openForSubscription: mailing.openForSubscription,
      from: mailing.from,
      replyTo: mailing.replyTo,
      sentCount: mailing.sentCount,
      ...await describeRetries(mailingRepository, mailing.id),
      space: mailing.space,
      state: mailing.state,
      test: mailing.test,
      undeliveredCount: mailing.undeliveredCount
    })));
    res.json(success(list));
  });
}
