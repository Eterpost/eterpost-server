import { MailingRepository } from '../MailingRepository';
import { Request, Response } from 'express';
import { error, success } from '../utils/response';
import { MailingState } from '../MailingState';
import { jsonSchemaMiddleware } from '../middleware/jsonSchemaMiddleware';
import { catchPromise } from '../utils/catchPromise';
import { getListId } from '../getListId';
import { Logger } from '../Logger';
import { Receiver } from '../Receiver';
import { ReceiverListFilter } from '../ReceiverListFilter';
import { generateUniqueCode } from '../utils/codes';
import { canSee, getSpaceAccess, spaceForNewMailing } from '../middleware/spaceAccess';
import { AttachmentStore } from '../AttachmentStore';
import {
  AttachmentInfo, detectContentType, getAttachmentsConfig, normalizeFilename, totalSize
} from '../attachments';
import { AttachmentUpload, attachFiles, sendTooLarge } from './attachments';


export function addMailing (config: any, mailingRepository: MailingRepository, logger: Logger,
  receiverListFilter: ReceiverListFilter, attachmentStore?: AttachmentStore) {
  const { maxSize } = getAttachmentsConfig(config);
  const handler = async function (req: Request, res: Response) {
    const access = getSpaceAccess(res);
    // Копия тоже создаётся в текущем пространстве, а не в пространстве исходной
    const space = spaceForNewMailing(access);
    if (!space) {
      res.status(403).json(error('Choose a space with X-Eterpost-Space', 'SPACE_REQUIRED'));
      return;
    }
    let receivers: Receiver[];
    let source;
    let isClone = false;
    let sourceMailingId = 0;
    if (req.body.sourceId) {
      const sourceMailing = await mailingRepository.getById(req.body.sourceId);
      if (!sourceMailing || !canSee(access, sourceMailing.space)) {
        res.status(404).json(error('Source mailing not found'));
        return;
      }
      source = sourceMailing;
      sourceMailingId = sourceMailing.id;
      isClone = true;
      receivers = await mailingRepository.getReceivers(sourceMailing.id);
    } else {
      source = req.body;
      receivers = req.body.receivers;
    }

    // Вложения: у копии — файлы исходной рассылки, у новой — из тела (base64)
    const uploads = isClone ? [] : parseAttachments(req.body.attachments);
    if (!uploads) {
      res.status(400).json(error('Attachment needs a file name and base64 content'));
      return;
    }
    const sourceAttachments: AttachmentInfo[] = isClone ? source.attachments : [];
    if (uploads.length + sourceAttachments.length && !attachmentStore?.available) {
      res.status(503).json(error('Attachments are unavailable', 'ATTACHMENTS_UNAVAILABLE'));
      return;
    }
    if (totalSize(uploads) > maxSize) {
      sendTooLarge(res, maxSize);
      return;
    }

    const properties = {
      creationDate: new Date(),
      extraData: source.extraData,
      html: source.html,
      listUnsubscribe: source.listUnsubscribe,
      tracking: source.tracking,
      name: source.name + (isClone ? ' (копия)' : ''),
      openForSubscription: source.openForSubscription,
      from: source.from,
      replyTo: source.replyTo,
      sentCount: 0,
      space,
      state: MailingState.NEW,
      subject: source.subject,
      test: Boolean(source.test),
      undeliveredCount: 0
    };
    const validReceivers = await receiverListFilter.getValidReceivers(receivers);
    // Коды нужны для ссылок отписки; у копии коды получателей сохраняются
    if (properties.openForSubscription) {
      for (const receiver of validReceivers) {
        receiver.code = receiver.code || generateUniqueCode();
      }
    }
    const mailing = await mailingRepository.create(properties, validReceivers);
    logger.info(`Created mailing ${properties.name} with ID #${mailing.id}`);

    const listId = getListId(config, mailing);
    await mailingRepository.updateInTransaction(mailing.id, mailingToUpdate => {
      mailingToUpdate.listId = listId;
    });
    logger.verbose(`#${mailing.id}: assigned List-Id = ${listId}`);

    if (uploads.length || sourceAttachments.length) {
      await attachFiles(
        mailingRepository, attachmentStore!, mailing, uploads, sourceMailingId, sourceAttachments
      );
    }

    res.json(success({
      id: mailing.id,
      listId,
      rejectedReceivers: receivers.filter(r => !validReceivers.find(vr => r.email === vr.email))
    }));
  };
  return [jsonSchemaMiddleware(requestBodyJsonSchema), catchPromise(handler)];
}

/**
 * Вложения из тела запроса; null — у вложения нет имени или содержимого
 */
function parseAttachments (attachments: unknown): AttachmentUpload[] | null {
  if (!Array.isArray(attachments)) {
    return [];
  }
  const result: AttachmentUpload[] = [];
  for (const attachment of attachments) {
    const filename = normalizeFilename(attachment?.filename);
    if (!filename || typeof attachment.content !== 'string') {
      return null;
    }
    const content = Buffer.from(attachment.content, 'base64');
    result.push({
      content,
      contentType: detectContentType(filename, attachment.contentType),
      filename,
      id: '',
      size: content.length
    });
  }
  return result;
}

export const requestBodyJsonSchema = {
  oneOf: [
    {
      type: 'object',
      additionalProperties: false,
      properties: {
        extraData: {
          type: 'object'
        },
        html: {
          type: 'string',
          minLength: 1
        },
        listUnsubscribe: {
          type: 'boolean'
        },
        tracking: {
          type: 'boolean'
        },
        name: {
          type: 'string',
          minLength: 1
        },
        openForSubscription: {
          type: 'boolean'
        },
        subject: {
          type: 'string',
          minLength: 1
        },
        test: {
          type: 'boolean'
        },
        receivers: {
          type: 'array',
          minItems: 1,
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              email: {
                type: 'string'
              },
              name: {
                type: 'string'
              },
              extraData: {
                type: 'object'
              }
            },
            required: [
              'email'
            ]
          }
        },
        from: {
          type: 'string',
          minLength: 1
        },
        replyTo: {
          type: 'string',
          minLength: 1
        },
        attachments: {
          type: 'array',
          description: 'Вложения письма; общий размер — не больше server.attachments.maxSize',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              filename: { type: 'string', minLength: 1 },
              contentType: { type: 'string' },
              content: { type: 'string', description: 'Содержимое файла в base64' }
            },
            required: ['filename', 'content']
          }
        }
      },
      required: [
        'html',
        'name',
        'receivers',
        'subject'
      ]
    },
    {
      type: 'object',
      additionalProperties: false,
      properties: {
        sourceId: {
          type: 'integer'
        }
      },
      required: [
        'sourceId'
      ]
    }
  ]
};
