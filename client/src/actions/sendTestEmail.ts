import { Mailing } from '../reducers/mailings';
import { sendTestEmail as sendTestEmailApi } from '../api';
import { notifyAboutError, notifySuccess } from './notify';
import { AppDispatch } from '../types';
import { describeAttachmentError } from './attachments';


/**
 * receiver — адрес получателя рассылки, чьими данными заполнить письмо
 */
export function sendTestEmail (mailing: Mailing, email: string, receiver?: string) {
  return async function (dispatch: AppDispatch) {
    try {
      const result = await sendTestEmailApi(mailing.id, email, receiver);
      if (!receiver) {
        dispatch(notifySuccess('Тестовое письмо отправлено.'));
      } else if (result?.receiverFound) {
        dispatch(notifySuccess(`Тестовое письмо с данными ${receiver} отправлено на ${email}.`));
      } else {
        dispatch(notifySuccess(
          `Тестовое письмо отправлено на ${email}. Адреса ${receiver} нет среди ` +
          'получателей рассылки — письмо заполнено только адресом.'
        ));
      }
    } catch (error) {
      dispatch(notifyAboutError(describeAttachmentError(
        error, 'Не удалось отправить тестовое письмо.'
      )));
    }
  };
}
