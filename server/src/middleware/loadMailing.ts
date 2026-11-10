import { NextFunction, Request, RequestHandler, Response } from 'express';
import { MailingRepository } from '../MailingRepository';
import { Mailing } from '../Mailing';
import { error } from '../utils/response';
import { canSee, getSpaceAccess } from './spaceAccess';


/**
 * Загружает рассылку из параметра маршрута и проверяет её пространство.
 * Рассылка чужого пространства — 404, как несуществующая: так её номер нельзя
 * подобрать. Проверенная рассылка — в res.locals.mailing (getLoadedMailing)
 */
export function loadMailing (
  repository: MailingRepository, param: 'id' | 'mailingId' = 'id'
): RequestHandler {
  return async function (req: Request, res: Response, next: NextFunction) {
    const id = Number(req.params[param]);
    if (!(id > 0)) {
      res.status(400).json(error('Invalid ID'));
      return;
    }
    let mailing: Mailing | null;
    try {
      mailing = await repository.getById(id);
    } catch (err) {
      console.error('Request error: ', err);
      res.status(500).json(error('Internal Server Error', 'INTERNAL_SERVER_ERROR'));
      return;
    }
    // NOT_FOUND — как раньше отвечал requestSubscription
    if (!mailing || !canSee(getSpaceAccess(res), mailing.space)) {
      res.status(404).json(error('Mailing not found', 'NOT_FOUND'));
      return;
    }
    res.locals.mailing = mailing;
    next();
  };
}

/**
 * Рассылка, загруженная loadMailing; без неё маршрут настроен с ошибкой
 */
export function getLoadedMailing (res: Response): Mailing {
  const mailing = res.locals.mailing;
  if (!mailing) {
    throw new Error('Mailing is not loaded: the route lacks loadMailing');
  }
  return mailing;
}
