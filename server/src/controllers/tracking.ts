import { Request, Response } from 'express';
import { MailingRepository, TrackedLetter } from '../MailingRepository';
import { success, error } from '../utils/response';
import { jsonSchemaMiddleware } from '../middleware/jsonSchemaMiddleware';
import { catchPromise } from '../utils/catchPromise';
import { isTrackingToken } from '../tracking';
import { canSee, getSpaceAccess } from '../middleware/spaceAccess';


/**
 * Открытие письма: subscription-facade отдаёт картинку-счётчик и сообщает
 * сюда. Неизвестный токен не ошибка: письмо могли открыть после удаления
 * рассылки. Ответ: { recorded }
 */
export function trackOpen (mailingRepository: MailingRepository) {
  const handler = async function (req: Request, res: Response) {
    const { mailingId, token } = req.body;
    const letter = await findLetter(mailingRepository, res, mailingId, token);
    if (letter) {
      await mailingRepository.recordOpen(mailingId, letter.email, new Date());
    }
    res.json(success({ recorded: Boolean(letter) }));
  };
  return [jsonSchemaMiddleware(openBodyJsonSchema), catchPromise(handler)];
}

/**
 * Переход по ссылке: subscription-facade получает отсюда исходный адрес и
 * перенаправляет на него. Адрес берётся только из сохранённого письма, так что
 * перенаправить на произвольный адрес нельзя. Переход считается и открытием.
 * Ответ: { url }; 404 — неизвестный токен или номер ссылки
 */
export function trackClick (mailingRepository: MailingRepository) {
  const handler = async function (req: Request, res: Response) {
    const { link, mailingId, token } = req.body;
    const letter = await findLetter(mailingRepository, res, mailingId, token);
    const url = letter && letter.links[link];
    if (!letter || !url) {
      res.status(404).json(error('Link not found'));
      return;
    }
    const date = new Date();
    await mailingRepository.recordOpen(mailingId, letter.email, date);
    await mailingRepository.recordClick(mailingId, letter.email, url, date);
    res.json(success({ url }));
  };
  return [jsonSchemaMiddleware(clickBodyJsonSchema), catchPromise(handler)];
}

/**
 * Письмо с отслеживанием. Сюда обращается subscription-facade служебным
 * ключом; ключу пространства письма чужих пространств не видны
 */
async function findLetter (
  mailingRepository: MailingRepository, res: Response, mailingId: number, token: string
): Promise<TrackedLetter | null> {
  if (!isTrackingToken(token)) {
    return null;
  }
  const access = getSpaceAccess(res);
  if (!access.system && !access.legacy) {
    const mailing = await mailingRepository.getById(mailingId);
    if (!mailing || !canSee(access, mailing.space)) {
      return null;
    }
  }
  return mailingRepository.getTrackedLetter(mailingId, token);
}

export const openBodyJsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    mailingId: { type: 'integer', minimum: 1 },
    token: { type: 'string', minLength: 1, maxLength: 64 }
  },
  required: ['mailingId', 'token']
};

export const clickBodyJsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    link: { type: 'integer', minimum: 0 },
    mailingId: { type: 'integer', minimum: 1 },
    token: { type: 'string', minLength: 1, maxLength: 64 }
  },
  required: ['link', 'mailingId', 'token']
};
