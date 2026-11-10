import { Mailing } from '../reducers/mailings';
import { sendTestEmail as sendTestEmailApi } from '../api';
import { notifyAboutError, notifySuccess } from './notify';
import { AppDispatch } from '../types';
import { describeAttachmentError } from './attachments';


export function sendTestEmail (mailing: Mailing, email: string) {
  return async function (dispatch: AppDispatch) {
    try {
      await sendTestEmailApi(mailing.id, email);
      dispatch(notifySuccess('Тестовое письмо отправлено.'));
    } catch (error) {
      dispatch(notifyAboutError(describeAttachmentError(
        error, 'Не удалось отправить тестовое письмо.'
      )));
    }
  };
}
