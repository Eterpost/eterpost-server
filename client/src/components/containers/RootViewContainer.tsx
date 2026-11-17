import * as React from 'react';
import '../../styles/RootView';
import '../../styles/AdminView';
import { MailingListContainer } from './MailingListContainer';
import { RootState } from '../../reducers';
import { connect } from 'react-redux';
import {
  MailingDetailViewContainer
} from './MailingDetailViewContainer';
import { createMailing } from '../../actions/createMailing';
import { hideAddForm } from '../../actions/hideAddForm';
import { AddForm, MailingCreateData } from '../AddForm';
import { Animator } from '../Animator';
import { Notifications } from '../Notifications';
import { SorterStatusView } from '../SorterStatusView';
import { NotificationItem } from '../../reducers/notifications';
import { hideNotification } from '../../actions/notify';
import { AppDispatch } from '../../types';
import { ActionTypes } from '../../ActionTypes';
import { Space } from '../../api';
import { getCurrentSpace } from '../../reducers/ui';
import { selectSpace } from '../../actions/loadSpaces';
import { SpaceSwitcher } from '../SpaceSwitcher';
import { getMe, Me } from '../../api';
import { AdminView } from '../admin/AdminView';
import { AdminTab, readAdminTabFromAddress, writeAdminTabToAddress } from '../../pageAddress';
import { notifyAboutError, notifySuccess } from '../../actions/notify';
import { selectMailing } from '../../actions/selectMailing';


export interface RootViewProps {
  notifications: NotificationItem[];
  onDismissNotification: (id: number) => void;
  onAdd: (mailing: MailingCreateData) => void;
  onError: (text: string) => void;
  onHideAddForm: () => void;
  onOpenMailing: (space: string, id: number) => void;
  onSelectSpace: (space: string) => void;
  onSuccess: (text: string) => void;
  onShowList: () => void;
  selectedMailing?: number;
  showAddForm: boolean;
  space?: string;
  spaceFrom?: string;
  spaces?: Space[];
}

interface RootViewState {
  // Открыт раздел «Администрирование» и его вкладка
  adminTab?: AdminTab;
  me?: Me;
}

class RootView extends React.Component<RootViewProps, RootViewState> {
  state: RootViewState = { adminTab: readAdminTabFromAddress() };

  componentDidMount () {
    // Не ответил — значит, обычный пользователь: раздела администрирования не будет
    getMe().then(me => this.setState({ me }), () => this.setState({ me: { admin: false } }));
  }

  render () {
    const admin = Boolean(this.state.me?.admin);
    if (admin && this.state.adminTab) {
      return (
        <div className='root-view'>
          <AdminView tab={this.state.adminTab} user={this.state.me?.user}
                     onTab={this.setAdminTab} onClose={() => this.setAdminTab(undefined)}
                     onOpenMailing={this.handleOpenMailing}
                     onError={this.props.onError} onSuccess={this.props.onSuccess} />
          <Notifications notifications={this.props.notifications}
                         onDismiss={this.props.onDismissNotification} />
        </div>
      );
    }
    const selected = typeof this.props.selectedMailing === 'number';
    // На узком экране видна одна колонка: список или выбранная рассылка
    const rightColumn = selected ? (
      <div className='right-column'>
        <button className='back-to-list' onClick={this.props.onShowList}>
          ← Все рассылки
        </button>
        <MailingDetailViewContainer />
      </div>
    ) : (
      <div className='right-column no-selection'>
        {this.props.spaces && !this.props.spaces.length ? null : (
          <p>Выберите рассылку в списке или добавьте новую.</p>
        )}
      </div>
    );
    const rootStyle = {
      filter: this.props.showAddForm ? 'blur(4px)' : ''
    };
    return (
      <div className='root-view'>
        <div className={'content' + (selected ? ' has-selection' : '')} style={rootStyle}>
          <div className='left-column'>
            <header className='app-brand'>
              <img src='favicon.svg' alt='' width={24} height={24} />
              Eterpost
              <SpaceSwitcher spaces={this.props.spaces || []} current={this.props.space}
                             onSelect={this.props.onSelectSpace} />
            </header>
            {admin ? (
              <div className='admin-entry'>
                <button className='admin-link' onClick={() => this.setAdminTab('mailings')}
                        title='Все рассылки, пространства и ключи API'>
                  Администрирование →
                </button>
              </div>
            ) : null}
            <MailingListContainer />
            <SorterStatusView />
          </div>
          {rightColumn}
        </div>
        <Animator show={this.props.showAddForm}>
          {nodeRef => (
            <AddForm containerRef={nodeRef} onAdd={this.props.onAdd}
                     onClose={this.props.onHideAddForm} spaceFrom={this.props.spaceFrom} />
          )}
        </Animator>
        <Notifications notifications={this.props.notifications}
                       onDismiss={this.props.onDismissNotification} />
      </div>
    );
  }

  private setAdminTab = (adminTab: AdminTab | undefined) => {
    writeAdminTabToAddress(adminTab);
    this.setState({ adminTab });
  };

  private handleOpenMailing = (space: string, id: number) => {
    this.setAdminTab(undefined);
    this.props.onOpenMailing(space, id);
  };
}

function mapStateToProps (state: RootState) {
  return {
    notifications: state.notifications,
    selectedMailing: state.mailings.selected,
    showAddForm: state.ui.showAddForm,
    space: state.ui.space,
    spaceFrom: getCurrentSpace(state.ui)?.from,
    spaces: state.ui.spaces
  };
}

function mapDispatchToProps (dispatch: AppDispatch) {
  return {
    onAdd: (data: MailingCreateData) => dispatch(createMailing(data)),
    onDismissNotification: (id: number) => dispatch(hideNotification(id)),
    onError: (text: string) => dispatch(notifyAboutError(text)),
    onHideAddForm: () => dispatch(hideAddForm()),
    // Рассылка открывается в своём пространстве: сначала переключаем его
    onOpenMailing: async (space: string, id: number) => {
      await dispatch(selectSpace(space));
      await dispatch(selectMailing(id));
    },
    onSelectSpace: (space: string) => dispatch(selectSpace(space)),
    onSuccess: (text: string) => dispatch(notifySuccess(text)),
    onShowList: () => dispatch({ data: undefined, type: ActionTypes.SELECT_MAILING })
  };
}

export const RootViewContainer = connect(
  mapStateToProps, mapDispatchToProps
)(RootView as any);
