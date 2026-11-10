import express, { NextFunction, Request, RequestHandler, Response } from 'express';
import { MailingRepository } from '../MailingRepository';
import { MailingState } from '../MailingState';
import { AttachmentStore } from '../AttachmentStore';
import {
  AttachmentInfo, detectContentType, normalizeFilename, totalSize
} from '../attachments';
import { getLoadedMailing } from '../middleware/loadMailing';
import { catchPromise } from '../utils/catchPromise';
import { error, success } from '../utils/response';
import { Logger } from '../Logger';
import { Mailing } from '../Mailing';


type Refusal = 'running' | 'size' | 'missing';

export interface AttachmentUpload extends AttachmentInfo {
  content: Buffer;
}

/**
 * Без хранилища (каталог не создан или недоступен) маршруты вложений
 * отвечают 503: рассылки без вложений при этом работают
 */
export function requireAttachmentStore (store?: AttachmentStore): RequestHandler {
  return function (req: Request, res: Response, next: NextFunction) {
    if (!store?.available) {
      res.status(503).json(error('Attachments are unavailable', 'ATTACHMENTS_UNAVAILABLE'));
      return;
    }
    next();
  };
}

/**
 * Тело загрузки — сам файл, не JSON; сверх лимита — 413
 */
export function rawAttachmentBody (maxSize: number): RequestHandler {
  const parser = express.raw({ limit: maxSize, type: () => true });
  return function (req: Request, res: Response, next: NextFunction) {
    parser(req, res, (err?: any) => {
      if (!err) {
        next();
      } else if (err.type === 'entity.too.large') {
        sendTooLarge(res, maxSize);
      } else {
        res.status(400).json(error('Cannot read the file'));
      }
    });
  };
}

export function uploadAttachment (
  repository: MailingRepository, store: AttachmentStore, maxSize: number, logger: Logger
) {
  return catchPromise(async function (req: Request, res: Response) {
    const mailing = getLoadedMailing(res);
    const filename = normalizeFilename(req.query.filename);
    if (!filename) {
      res.status(400).json(error('File name is required (?filename=)'));
      return;
    }
    const content: Buffer = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    const info: AttachmentInfo = {
      contentType: detectContentType(filename, req.get('content-type')),
      filename,
      id: '',
      size: content.length
    };
    let refusal: Refusal | null =
      checkChange(mailing.state, mailing.attachments, info.size, maxSize);
    if (refusal) {
      sendRefusal(res, refusal, maxSize);
      return;
    }

    info.id = await store.save(mailing.id, content);
    // Состояние и размер проверяются ещё раз в транзакции: рассылку могли
    // запустить или дополнить, пока файл записывался
    const updated = await repository.updateInTransaction(mailing.id, mailingToUpdate => {
      refusal = checkChange(
        mailingToUpdate.state, mailingToUpdate.attachments, info.size, maxSize
      );
      if (!refusal) {
        mailingToUpdate.attachments.push(info);
      }
    });
    if (!updated || refusal) {
      await store.remove(mailing.id, info.id);
      sendRefusal(res, refusal || 'missing', maxSize);
      return;
    }
    logger.info(`#${mailing.id}: added attachment ${filename} (${info.size} bytes)`);
    res.status(201).json(success(info));
  });
}

export function downloadAttachment (store: AttachmentStore) {
  return catchPromise(async function (req: Request, res: Response) {
    const mailing = getLoadedMailing(res);
    const attachment = mailing.attachments.find(a => a.id === req.params.attachmentId);
    if (!attachment) {
      sendNotFound(res);
      return;
    }
    res.attachment(attachment.filename);
    res.type(attachment.contentType);
    await new Promise<void>(resolve => {
      // Каталог хранилища может лежать под каталогом с точкой (/tmp/.private)
      res.sendFile(store.path(mailing.id, attachment.id), { dotfiles: 'allow' }, err => {
        if (err && !res.headersSent) {
          sendNotFound(res);
        }
        resolve();
      });
    });
  });
}

export function deleteAttachment (
  repository: MailingRepository, store: AttachmentStore, logger: Logger
) {
  return catchPromise(async function (req: Request, res: Response) {
    const mailing = getLoadedMailing(res);
    const id = req.params.attachmentId;
    let refusal: Refusal | null = null;
    let removed: AttachmentInfo | undefined;
    const updated = await repository.updateInTransaction(mailing.id, mailingToUpdate => {
      removed = undefined;
      refusal = mailingToUpdate.state === MailingState.RUNNING ? 'running' : null;
      const index = mailingToUpdate.attachments.findIndex(a => a.id === id);
      if (!refusal && index >= 0) {
        [removed] = mailingToUpdate.attachments.splice(index, 1);
      }
    });
    if (!updated) {
      sendRefusal(res, 'missing', 0);
      return;
    }
    if (refusal) {
      sendRefusal(res, refusal, 0);
      return;
    }
    if (!removed) {
      sendNotFound(res);
      return;
    }
    await store.remove(mailing.id, removed.id);
    logger.info(`#${mailing.id}: removed attachment ${removed.filename}`);
    res.json(success());
  });
}

/**
 * Можно ли добавить вложение размером size: письма выполняющейся рассылки
 * должны быть одинаковыми, общий размер ограничен
 */
export function checkChange (
  state: MailingState, attachments: AttachmentInfo[], size: number, maxSize: number
): Refusal | null {
  if (state === MailingState.RUNNING) {
    return 'running';
  }
  if (totalSize(attachments) + size > maxSize) {
    return 'size';
  }
  return null;
}

export function sendTooLarge (res: Response, maxSize: number) {
  res.status(413).json(error(
    `Attachments of a mailing must not exceed ${maxSize} bytes in total`,
    'ATTACHMENTS_TOO_LARGE'
  ));
}

function sendRefusal (res: Response, refusal: Refusal, maxSize: number) {
  if (refusal === 'running') {
    res.status(409).json(error(
      'Cannot change attachments of a running mailing', 'MAILING_RUNNING'
    ));
  } else if (refusal === 'size') {
    sendTooLarge(res, maxSize);
  } else {
    res.status(404).json(error('Mailing not found', 'NOT_FOUND'));
  }
}

function sendNotFound (res: Response) {
  res.status(404).json(error('Attachment not found', 'NOT_FOUND'));
}

/**
 * Сохраняет файлы вложений новой рассылки и их описания. Если это не удалось,
 * рассылка удаляется: без вложений она ушла бы не тем письмом
 */
export async function attachFiles (
  repository: MailingRepository, store: AttachmentStore, mailing: Mailing,
  uploads: AttachmentUpload[], sourceMailingId: number, sourceAttachments: AttachmentInfo[]
) {
  try {
    const attachments = sourceAttachments.length ?
      await store.copy(sourceMailingId, mailing.id, sourceAttachments) : [];
    for (const { content, ...info } of uploads) {
      attachments.push({ ...info, id: await store.save(mailing.id, content) });
    }
    await repository.updateInTransaction(mailing.id, mailingToUpdate => {
      mailingToUpdate.attachments = attachments;
    });
  } catch (err) {
    await repository.remove(mailing);
    await store.removeAll(mailing.id);
    throw err;
  }
}
