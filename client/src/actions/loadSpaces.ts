import { getSpaces, MailingKind, setCurrentSpace } from '../api';
import { ActionTypes } from '../ActionTypes';
import { notifyAboutError } from './notify';
import { loadMailings } from './loadMailings';
import { AppDispatch } from '../types';
import {
  readSpaceFromAddress, readStoredSpace, storeSpace, writeKindToAddress, writeSpaceToAddress
} from '../pageAddress';


let loadingSpaces = false;

/**
 * Загружает пространства пользователя и выбирает текущее: из адреса страницы,
 * затем последнее выбранное, затем первое. forget — забыть прежний выбор
 * (сервер ответил, что доступа к нему больше нет)
 */
export function loadSpaces (forget = false) {
  return async function (dispatch: AppDispatch) {
    if (loadingSpaces) {
      return;
    }
    loadingSpaces = true;
    try {
      if (forget) {
        storeSpace(undefined);
        writeSpaceToAddress(undefined);
        dispatch(notifyAboutError(
          'Нет доступа к выбранному пространству, открыто первое доступное.'
        ));
      }
      const spaces = await getSpaces();
      dispatch({ data: spaces, type: ActionTypes.SET_SPACES });
      if (!spaces.length) {
        setCurrentSpace(undefined);
        dispatch({ data: undefined, type: ActionTypes.SET_CURRENT_SPACE });
        dispatch({ type: ActionTypes.RESET_MAILINGS });
        return;
      }
      const known = (name?: string) => spaces.some(space => space.name === name);
      const fromAddress = readSpaceFromAddress();
      const stored = readStoredSpace();
      const space = known(fromAddress) ? fromAddress! :
        known(stored) ? stored! : spaces[0].name;
      dispatch(selectSpace(space));
    } catch (error) {
      dispatch(notifyAboutError('Не удалось загрузить список пространств.'));
    } finally {
      loadingSpaces = false;
    }
  };
}

/**
 * Переключает пространство: рассылки в списке — только его, выбранная рассылка сбрасывается
 */
export function selectSpace (space: string) {
  return function (dispatch: AppDispatch) {
    setCurrentSpace(space);
    storeSpace(space);
    writeSpaceToAddress(space);
    dispatch({ data: space, type: ActionTypes.SET_CURRENT_SPACE });
    dispatch({ type: ActionTypes.RESET_MAILINGS });
    return dispatch(loadMailings());
  };
}

/**
 * Фильтр списка: боевые, пробные или все рассылки пространства
 */
export function selectMailingKind (kind: MailingKind) {
  return function (dispatch: AppDispatch) {
    writeKindToAddress(kind);
    dispatch({ data: kind, type: ActionTypes.SET_MAILING_KIND });
    dispatch({ type: ActionTypes.RESET_MAILINGS });
    return dispatch(loadMailings());
  };
}
