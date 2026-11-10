import { CreateResponse } from '../api';
import { Mailing } from '../reducers/mailings';
import { reloadMailingsData } from './reloadMailingsData';
import { selectMailing } from './selectMailing';
import { selectMailingKind } from './loadSpaces';
import { AppDispatch } from '../types';
import { RootState } from '../reducers';


export function cloneWithApi (
  api: (id: number) => Promise<CreateResponse>,
  mailing: Mailing
) {
  return async function (dispatch: AppDispatch, getState: () => RootState) {
    const { id } = await api(mailing.id);
    await dispatch(reloadMailingsData());
    // Копия не подходит под фильтр списка (боевая среди пробных или наоборот):
    // показываем все рассылки, иначе выбрать её было бы негде
    if (!getState().mailings.byId[id]) {
      await dispatch(selectMailingKind('all'));
    }
    await dispatch(selectMailing(id));
  };
}
