import { getMailings } from '../api';
import { ActionTypes } from '../ActionTypes';
import { notifyAboutError } from './notify';
import { AppDispatch } from '../types';
import { RootState } from '../reducers';


export function loadMailings () {
  return async function (dispatch: AppDispatch, getState: () => RootState) {
    const { kind, space } = getState().ui;
    if (!space) {
      return;
    }
    try {
      const mailings = await getMailings(kind);
      // Пока шёл запрос, могли переключить пространство или фильтр: этот список уже не нужен
      const ui = getState().ui;
      if (ui.space !== space || ui.kind !== kind) {
        return;
      }
      dispatch({
        data: mailings,
        type: ActionTypes.SET_MAILINGS
      });
    } catch (error) {
      dispatch(notifyAboutError('Не удалось загрузить список рассылок.'));
    }
  };
}
