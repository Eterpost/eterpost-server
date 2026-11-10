import { Action } from '../types';
import { ActionTypes } from '../ActionTypes';
import { MailingKind, Space } from '../api';


export interface UiState {
  // Какие рассылки показывать в списке: боевые, пробные или все
  kind: MailingKind;
  showAddForm: boolean;
  // Текущее пространство; spaces — доступные пользователю, undefined — ещё не загружены
  space?: string;
  spaces?: Space[];
}

const initialState: UiState = {
  kind: 'live',
  showAddForm: false
};


export function ui (state: UiState = initialState, action: Action): UiState {
  switch (action.type) {
    case ActionTypes.SHOW_ADD_FORM:
      return Object.assign({}, state, {
        showAddForm: true
      });
    case ActionTypes.HIDE_ADD_FORM:
      return Object.assign({}, state, {
        showAddForm: false
      });
    case ActionTypes.SET_SPACES:
      return Object.assign({}, state, {
        spaces: action.data
      });
    case ActionTypes.SET_CURRENT_SPACE:
      return Object.assign({}, state, {
        space: action.data
      });
    case ActionTypes.SET_MAILING_KIND:
      return Object.assign({}, state, {
        kind: action.data
      });
    default:
      return state;
  }
}

// Пространство, рассылки которого сейчас в списке, вместе с данными о нём
export function getCurrentSpace (state: UiState): Space | undefined {
  return state.spaces && state.spaces.find(space => space.name === state.space);
}
