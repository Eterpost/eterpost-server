import { updateMailing as updateMailingOnServer } from '../api';
import { MailingState } from '../../../server/src/MailingState';
import { updateMailing } from './updateMailing';
import { notifyAboutError } from './notify';
import { AppDispatch } from '../types';
import { describeAttachmentError } from './attachments';


export function startMailing (id: number) {
  return async function (dispatch: AppDispatch) {
    try {
      dispatch(updateMailing(id, {
        locked: true
      }));
      await updateMailingOnServer(id, {
        state: MailingState.RUNNING
      });
      dispatch(updateMailing(id, {
        locked: false,
        state: MailingState.RUNNING
      }));
    } catch (error) {
      dispatch(notifyAboutError(describeAttachmentError(error, 'Не удалось запустить рассылку.')));
      dispatch(updateMailing(id, {
        locked: false
      }));
    }
  };
}
