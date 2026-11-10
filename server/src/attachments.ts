import path from 'node:path';

// У модуля nodemailer нет типов: таблица типов по расширению
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { detectMimeType } = require('nodemailer/lib/mime-funcs/mime-types') as {
  detectMimeType: (filename: string) => string
};


/**
 * Описание вложения рассылки; сам файл — в AttachmentStore
 */
export interface AttachmentInfo {
  contentType: string;
  filename: string;
  id: string;
  size: number;
}

export const DEFAULT_ATTACHMENTS_DIR = 'data/attachments';
export const DEFAULT_ATTACHMENTS_MAX_SIZE = 10 * 1024 * 1024;

const MAX_FILENAME_LENGTH = 200;
const OCTET_STREAM = 'application/octet-stream';

/**
 * Имя файла вложения: последняя часть пути (и с / и с \), без управляющих
 * символов, не длиннее 200 символов с сохранением расширения. null — имени нет
 */
export function normalizeFilename (name: unknown): string | null {
  if (typeof name !== 'string') {
    return null;
  }
  // eslint-disable-next-line no-control-regex
  let result = (name.split(/[/\\]/).pop() || '').replace(/[\u0000-\u001f\u007f]/g, '').trim();
  if (!result || result === '.' || result === '..') {
    return null;
  }
  if (result.length > MAX_FILENAME_LENGTH) {
    const extension = path.extname(result).slice(0, 20);
    result = result.slice(0, MAX_FILENAME_LENGTH - extension.length) + extension;
  }
  return result;
}

/**
 * Тип содержимого: заявленный при загрузке, если он что-то говорит, иначе по
 * расширению. Типы форм (их ставит curl по умолчанию) о файле не говорят
 */
export function detectContentType (filename: string, declared?: string): string {
  if (declared && declared !== OCTET_STREAM && !isFormType(declared)) {
    return declared;
  }
  return detectMimeType(filename) || OCTET_STREAM;
}

export function isFormType (contentType: string): boolean {
  return /^\s*(multipart\/|application\/x-www-form-urlencoded)/i.test(contentType);
}

export function totalSize (attachments: AttachmentInfo[] | undefined): number {
  return (attachments || []).reduce((sum, attachment) => sum + attachment.size, 0);
}

export function getAttachmentsConfig (config: any): { dir: string, maxSize: number } {
  const attachments = config.server?.attachments || {};
  return {
    dir: attachments.dir || DEFAULT_ATTACHMENTS_DIR,
    maxSize: attachments.maxSize || DEFAULT_ATTACHMENTS_MAX_SIZE
  };
}
