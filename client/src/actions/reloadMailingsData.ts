import { getMailings } from '../api';
import { RootState } from '../reducers';
import { updateMailing } from './updateMailing';
import { addMailing } from './addMailing';
import { AppDispatch } from '../types';


export function reloadMailingsData () {
  return async function (dispatch: AppDispatch, getState: () => RootState) {
    const { kind, space } = getState().ui;
    // Пока список не загружен, обновлять нечего: иначе он показался бы раньше времени
    if (!space || !getState().mailings.loaded) {
      return;
    }
    const mailings = await getMailings(kind);
    const state = getState();
    if (state.ui.space !== space || state.ui.kind !== kind || !state.mailings.loaded) {
      return;
    }
    mailings.forEach(mailing => {
      if (state.mailings.byId[mailing.id]) {
        dispatch(updateMailing(mailing.id, {
          sentCount: mailing.sentCount,
          state: mailing.state,
          undeliveredCount: mailing.undeliveredCount
        }));
      } else {
        dispatch(addMailing(mailing as any, mailing.id, mailing.listId));
      }
    });
  };
}
