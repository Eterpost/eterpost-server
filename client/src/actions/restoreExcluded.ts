import { restoreExcluded as restoreExcludedApi } from '../api';
import { notifyAboutError, notifySuccess } from './notify';
import { reloadFailedReceivers } from './reloadFailedReceivers';
import { reloadSingleMailing } from './reloadSingleMailing';
import { AppDispatch } from '../types';


/**
 * Вернуть в рассылку исключённые из-за ошибок доставки адреса: все или emails
 */
export function restoreExcluded (mailingId: number, emails?: string[]) {
  return async function (dispatch: AppDispatch) {
    try {
      const { restored } = await restoreExcludedApi(mailingId, emails);
      dispatch(notifySuccess(restored.length === 1 ?
        `Адрес ${restored[0]} возвращён в рассылку.` :
        `Возвращено в рассылку адресов: ${restored.length}.`));
    } catch (error) {
      dispatch(notifyAboutError('Не удалось вернуть адреса в рассылку.'));
    }
    await Promise.all([
      dispatch(reloadSingleMailing(mailingId)),
      dispatch(reloadFailedReceivers(mailingId))
    ]);
  };
}
