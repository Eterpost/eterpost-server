import { Mailing } from '../reducers/mailings';
import { EmailPreview, previewEmail as previewEmailApi } from '../api';
import { notifyAboutError } from './notify';
import { AppDispatch } from '../types';


export function previewEmail (mailing: Mailing, email: string) {
  return async function (dispatch: AppDispatch): Promise<EmailPreview | null> {
    try {
      return await previewEmailApi(mailing.id, email);
    } catch (error) {
      dispatch(notifyAboutError('Не удалось собрать письмо для предпросмотра.'));
      return null;
    }
  };
}
