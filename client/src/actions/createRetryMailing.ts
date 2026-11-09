import { createRetryMailing as createRetryMailingOnServer, RetryFilter } from '../api';
import { notifyAboutError, notifySuccess } from './notify';
import { Mailing } from '../reducers/mailings';
import { cloneWithApi } from './cloneWithApi';
import { AppDispatch } from '../types';


export function createRetryMailing (mailing: Mailing, filter?: RetryFilter) {
  return async function (dispatch: AppDispatch) {
    try {
      if (!mailing.failedReceiversCount) {
        dispatch(notifyAboutError('По этой рассылке нет ошибок доставки.'));
        return;
      }
      await dispatch(cloneWithApi(id => createRetryMailingOnServer(id, filter), mailing));
      dispatch(notifySuccess('Рассылка дублирована успешно.'));
    } catch (error) {
      dispatch(notifyAboutError('Не удалось дублировать рассылку.'));
    }
  };
}
