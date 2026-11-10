import { legacy_createStore as createStore, applyMiddleware, Store } from 'redux';
import * as React from 'react';
import { Provider } from 'react-redux';
import rootReducer, { RootState } from './reducers';
import { createRoot } from 'react-dom/client';
import { RootViewContainer } from './components/containers/RootViewContainer';
import { thunk } from 'redux-thunk';
import { loadSpaces } from './actions/loadSpaces';
import { reloadMailingsData } from './actions/reloadMailingsData';
import { AppDispatch } from './types';
import { ActionTypes } from './ActionTypes';
import { onApiError } from './api';
import { readKindFromAddress } from './pageAddress';


export class MailingApp {
  private store: Store<RootState> & { dispatch: AppDispatch };

  constructor (private rootNode: HTMLElement) {
    this.start();
  }

  private async start () {
    this.store = createStore(
      rootReducer,
      applyMiddleware(thunk)
    ) as unknown as Store<RootState> & { dispatch: AppDispatch };
    const component = (
      <Provider store={this.store}>
        <RootViewContainer />
      </Provider>
    );
    createRoot(this.rootNode).render(component);
    this.store.dispatch({ data: readKindFromAddress(), type: ActionTypes.SET_MAILING_KIND });
    // Доступ к выбранному пространству пропал (например, пользователя убрали из участников):
    // забываем выбор и открываем первое доступное
    onApiError(error => {
      if (error.code === 'SPACE_FORBIDDEN') {
        this.store.dispatch(loadSpaces(true));
      }
    });
    this.store.dispatch(loadSpaces());
    setInterval(() => {
      // Фоновое обновление: при ошибке просто попробуем в следующий раз
      this.store.dispatch(reloadMailingsData()).catch(() => undefined);
    }, 5000);
  }
}
