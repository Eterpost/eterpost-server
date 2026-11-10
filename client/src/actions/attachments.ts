import {
  ApiError, deleteAttachment as deleteAttachmentApi, getMailingById,
  uploadAttachment as uploadAttachmentApi
} from '../api';
import { updateMailing } from './updateMailing';
import { notifyAboutError, notifySuccess } from './notify';
import { AppDispatch } from '../types';


function reloadAttachments (id: number) {
  return async function (dispatch: AppDispatch) {
    const mailing = await getMailingById(id);
    dispatch(updateMailing(id, {
      attachments: mailing.attachments,
      attachmentsMaxSize: mailing.attachmentsMaxSize
    }));
  };
}

/**
 * Понятная человеку причина ошибки вложения
 */
export function describeAttachmentError (error: unknown, fallback: string): string {
  if (error instanceof ApiError) {
    if (error.status === 413) {
      return 'Превышен общий размер вложений рассылки.';
    }
    if (error.code === 'MAILING_RUNNING') {
      return 'Рассылка выполняется: сначала приостановите её.';
    }
    if (error.code === 'MISSING_ATTACHMENT') {
      return 'Файл вложения пропал с сервера: удалите его и приложите заново. ' +
        (error.detail || '');
    }
    if (error.code === 'ATTACHMENTS_UNAVAILABLE') {
      return 'Вложения на сервере недоступны: проверьте каталог server.attachments.dir.';
    }
  }
  return fallback;
}

export function addAttachments (mailingId: number, files: File[]) {
  return async function (dispatch: AppDispatch) {
    let added = 0;
    for (const file of files) {
      try {
        await uploadAttachmentApi(mailingId, file);
        added++;
      } catch (error) {
        dispatch(notifyAboutError(describeAttachmentError(
          error, `Не удалось приложить файл ${file.name}.`
        )));
        break;
      }
    }
    await dispatch(reloadAttachments(mailingId));
    if (added) {
      dispatch(notifySuccess(added === 1 ? 'Файл приложен.' : `Приложено файлов: ${added}.`));
    }
  };
}

export function deleteAttachment (mailingId: number, id: string) {
  return async function (dispatch: AppDispatch) {
    try {
      await deleteAttachmentApi(mailingId, id);
    } catch (error) {
      dispatch(notifyAboutError(describeAttachmentError(
        error, 'Не удалось удалить вложение.'
      )));
    }
    await dispatch(reloadAttachments(mailingId));
  };
}
