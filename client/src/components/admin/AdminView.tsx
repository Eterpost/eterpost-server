import * as React from 'react';
import '../../styles/AdminView';
import { AdminTab } from '../../pageAddress';
import { AdminMailings } from './AdminMailings';
import { AdminSpaces } from './AdminSpaces';
import { AdminKeys } from './AdminKeys';
import { AdminNotify } from './common';


export interface AdminViewProps extends AdminNotify {
  onClose: () => void;
  onOpenMailing: (space: string, id: number) => void;
  onTab: (tab: AdminTab) => void;
  tab: AdminTab;
  user?: string;
}

interface AdminViewState {
  // Фильтр вкладки «Все рассылки» по пространству
  space?: string;
}

const TABS: Array<[AdminTab, string]> = [
  ['mailings', 'Все рассылки'], ['spaces', 'Пространства'], ['keys', 'Ключи API']
];

/**
 * Раздел «Администрирование»: все рассылки, пространства, ключи API
 */
export class AdminView extends React.Component<AdminViewProps, AdminViewState> {
  state: AdminViewState = {};

  render () {
    const notify = { onError: this.props.onError, onSuccess: this.props.onSuccess };
    return (
      <div className='admin-view'>
        <header className='app-brand admin-header'>
          <img src='favicon.svg' alt='' width={24} height={24} />
          Eterpost — администрирование
          <button className='link-button admin-back' onClick={this.props.onClose}>
            ← К рассылкам
          </button>
          {this.props.user ? <span className='admin-user'>{this.props.user}</span> : null}
        </header>
        <nav className='admin-tabs' aria-label='Разделы администрирования'>
          {TABS.map(([tab, title]) => (
            <button key={tab} className={'admin-tab' + (tab === this.props.tab ? ' active' : '')}
                    aria-current={tab === this.props.tab ? 'page' : undefined}
                    onClick={() => this.props.onTab(tab)}>
              {title}
            </button>
          ))}
        </nav>
        <main className='admin-body'>
          {this.props.tab === 'mailings' ? (
            <AdminMailings {...notify} space={this.state.space}
                           onSpaceFilter={space => this.setState({ space })}
                           onOpenMailing={this.props.onOpenMailing} />
          ) : null}
          {this.props.tab === 'spaces' ? (
            <AdminSpaces {...notify} onShowMailings={this.showMailings} />
          ) : null}
          {this.props.tab === 'keys' ? <AdminKeys {...notify} /> : null}
        </main>
      </div>
    );
  }

  private showMailings = (space: string) => {
    this.setState({ space });
    this.props.onTab('mailings');
  };
}
