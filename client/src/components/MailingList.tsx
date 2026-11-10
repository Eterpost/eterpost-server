import * as React from 'react';
import { Mailing } from '../reducers/mailings';
import '../styles/List';
import { StateMarker } from './StateMarker';
import { Loading } from './elements/Loading';
import { mailingStateNames } from './MailingStateView';
import { MailingKind } from '../api';


const NO_SPACES_TEXT = 'Вас ещё не добавили ни в одно пространство. ' +
  'Обратитесь к администратору';

const kindNames: Array<[MailingKind, string]> = [
  ['live', 'Боевые'],
  ['test', 'Пробные'],
  ['all', 'Все']
];

export interface MailingListProps {
  kind?: MailingKind;
  loaded?: boolean;
  mailings: Mailing[];
  // Пространства загружены, но пользователю не доступно ни одно
  noSpaces?: boolean;
  onSelectKind?: (kind: MailingKind) => void;
  onShowAddForm?: () => void;
  onSelect?: (mailing: Mailing) => void;
  selectedMailing?: number;
}

export class MailingList extends React.Component<MailingListProps> {
  render () {
    // Новые сверху: обычно работают с последними рассылками
    const sorted = this.props.mailings.slice(0).sort((a, b) => b.id - a.id);
    const items = sorted.map(mailing => {
      const selected = mailing.id === this.props.selectedMailing;
      const onClick = (() => this.props.onSelect && this.props.onSelect(mailing));
      return (
        <li className={selected ? 'selected' : ''} key={mailing.id}>
          <button className='mailing-item' onClick={onClick} aria-current={selected}>
            <span className='mailing-name'>
              {mailing.name}
              {mailing.test ? <span className='test-label'>проба</span> : null}
            </span>
            <span className='mailing-meta'>
              <StateMarker state={mailing.state} />
              {mailingStateNames[mailing.state]}
              {mailing.sentCount ? ` · отправлено ${mailing.sentCount}` : null}
              {mailing.locked ? <Loading> · загрузка</Loading> : null}
            </span>
          </button>
        </li>
      );
    });
    if (this.props.noSpaces) {
      return (
        <div className='list-block mailing-list'>
          <h2 className='block-header'>Рассылки</h2>
          <p className='list-empty'>{NO_SPACES_TEXT}</p>
        </div>
      );
    }
    return (
      <div className='list-block mailing-list'>
        <h2 className='block-header'>
          Рассылки
          <div className='header-actions'>
            <button className='action' onClick={this.props.onShowAddForm}>
              Добавить
            </button>
          </div>
        </h2>
        {this.renderKindFilter()}
        {this.renderEmpty()}
        <ul className='list'>
          {items}
        </ul>
      </div>
    );
  }

  private renderKindFilter () {
    const current = this.props.kind || 'live';
    const buttons = kindNames.map(([kind, name]) => (
      <button key={kind} className={'kind-button' + (kind === current ? ' active' : '')}
              aria-pressed={kind === current}
              onClick={() => this.props.onSelectKind && this.props.onSelectKind(kind)}>
        {name}
      </button>
    ));
    return (
      <div className='kind-filter' role='group' aria-label='Какие рассылки показать'>
        {buttons}
      </div>
    );
  }

  private renderEmpty () {
    if (this.props.mailings.length) {
      return null;
    }
    if (!this.props.loaded) {
      return <p className='list-empty'><Loading>Загрузка…</Loading></p>;
    }
    if (this.props.kind === 'test') {
      return (
        <p className='list-empty'>
          Пробных рассылок нет: их отмечают флажком «Пробная» в форме рассылки.
        </p>
      );
    }
    return (
      <p className='list-empty'>
        Рассылок пока нет. Нажмите «Добавить», чтобы создать первую: понадобится
        текст письма и список получателей в CSV.
      </p>
    );
  }
}
