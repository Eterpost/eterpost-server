import * as React from 'react';
import { MailingState } from '../../../../server/src/MailingState';
import { AdminSpace, getAdminSpaces, getAllMailings, moveMailing } from '../../api';
import { Mailing } from '../../reducers/mailings';
import { mailingStateNames, MailingStateView } from '../MailingStateView';
import { Button } from '../elements/Button';
import { Loading } from '../elements/Loading';
import { AdminNotify, describeError, spaceTitle } from './common';


type SortKey = 'id' | 'name' | 'sentCount' | 'space' | 'state' | 'undeliveredCount';
type Kind = 'all' | 'live' | 'test';

export interface AdminMailingsProps extends AdminNotify {
  // Фильтр по пространству, заданный извне (ссылка из вкладки «Пространства»)
  space?: string;
  onOpenMailing: (space: string, id: number) => void;
  onSpaceFilter: (space: string | undefined) => void;
}

interface AdminMailingsState {
  kind: Kind;
  mailings?: Mailing[];
  search: string;
  sort: SortKey;
  sortDesc: boolean;
  spaces: AdminSpace[];
  state?: MailingState;
}

const COLUMNS: Array<[SortKey, string]> = [
  ['id', '№'], ['space', 'Пространство'], ['name', 'Название'], ['state', 'Состояние'],
  ['sentCount', 'Отправлено'], ['undeliveredCount', 'Ошибок']
];

const NUMERIC: SortKey[] = ['id', 'sentCount', 'undeliveredCount'];

const KINDS: Array<[Kind, string]> = [['live', 'Боевые'], ['test', 'Пробные'], ['all', 'Все']];

/**
 * Все рассылки всех пространств: фильтры, сортировка, переход к рассылке и перенос
 */
export class AdminMailings extends React.Component<AdminMailingsProps, AdminMailingsState> {
  state: AdminMailingsState = {
    kind: 'all', search: '', sort: 'id', sortDesc: true, spaces: []
  };

  componentDidMount () {
    this.load();
  }

  render () {
    const { mailings, spaces } = this.state;
    if (!mailings) {
      return <p className='admin-empty'><Loading>Загрузка…</Loading></p>;
    }
    const shown = this.filtered(mailings);
    return (
      <div className='admin-mailings'>
        {this.renderSummary(mailings)}
        <div className='admin-filters'>
          <label>
            Пространство
            <select value={this.props.space || ''} onChange={this.handleSpace}>
              <option value=''>все</option>
              {spaces.map(space => (
                <option key={space.name} value={space.name}>{space.title || space.name}</option>
              ))}
            </select>
          </label>
          <label>
            Состояние
            <select value={this.state.state ?? ''} onChange={this.handleState}>
              <option value=''>любое</option>
              {Object.entries(mailingStateNames).map(([value, title]) => (
                <option key={value} value={value}>{title}</option>
              ))}
            </select>
          </label>
          <div className='kind-filter' role='group' aria-label='Какие рассылки показать'>
            {KINDS.map(([kind, title]) => (
              <button key={kind}
                      className={'kind-button' + (kind === this.state.kind ? ' active' : '')}
                      aria-pressed={kind === this.state.kind}
                      onClick={() => this.setState({ kind })}>
                {title}
              </button>
            ))}
          </div>
          <input className='input admin-search' type='search' value={this.state.search}
                 placeholder='поиск по названию' aria-label='Поиск по названию'
                 onChange={event => this.setState({ search: event.currentTarget.value })} />
          <Button small onClick={this.load}>Обновить</Button>
        </div>
        <p className='admin-count'>Показано {shown.length} из {mailings.length}</p>
        <div className='admin-table-wrap'>
          <table className='admin-table'>
            <thead>
              <tr>
                {COLUMNS.map(([key, title]) => (
                  <th key={key} aria-sort={this.ariaSort(key)}
                      className={NUMERIC.includes(key) ? 'number' : undefined}>
                    <button className='sort-button' onClick={() => this.handleSort(key)}>
                      {title}{this.sortMark(key)}
                    </button>
                  </th>
                ))}
                <th>Перенести в…</th>
              </tr>
            </thead>
            <tbody>
              {shown.map(mailing => this.renderRow(mailing))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  private renderSummary (mailings: Mailing[]) {
    const running = mailings.filter(mailing => mailing.state === MailingState.RUNNING);
    if (!running.length) {
      return <p className='admin-summary'>Сейчас ни одна рассылка не выполняется.</p>;
    }
    const bySpace = new Map<string, number>();
    for (const mailing of running) {
      const space = mailing.space || 'default';
      bySpace.set(space, (bySpace.get(space) || 0) + 1);
    }
    const parts = [...bySpace].map(([space, count]) =>
      `${spaceTitle(this.state.spaces, space)}: ${count}`);
    return (
      <p className='admin-summary running'>
        Сейчас выполняется {running.length} — {parts.join(', ')}.
      </p>
    );
  }

  private renderRow (mailing: Mailing) {
    const space = mailing.space || 'default';
    const open = () => this.props.onOpenMailing(space, mailing.id);
    return (
      <tr key={mailing.id}>
        <td className='number'>{mailing.id}</td>
        <td>{spaceTitle(this.state.spaces, space)}</td>
        <td>
          <button className='link-button' onClick={open}
                  title='Открыть рассылку в её пространстве'>
            {mailing.name}
          </button>
          {mailing.test ? <span className='test-label'>проба</span> : null}
        </td>
        <td><MailingStateView state={mailing.state} /></td>
        <td className='number'>{mailing.sentCount}</td>
        <td className='number'>{mailing.undeliveredCount}</td>
        <td>
          <select value='' aria-label={`Перенести рассылку «${mailing.name}»`}
                  disabled={mailing.state === MailingState.RUNNING}
                  title={mailing.state === MailingState.RUNNING ?
                    'Сначала остановите рассылку' : undefined}
                  onChange={event => this.handleMove(mailing, event.currentTarget.value)}>
            <option value=''>—</option>
            {this.state.spaces.filter(item => item.name !== space).map(item => (
              <option key={item.name} value={item.name}>{item.title || item.name}</option>
            ))}
          </select>
        </td>
      </tr>
    );
  }

  private filtered (mailings: Mailing[]): Mailing[] {
    const search = this.state.search.trim().toLowerCase();
    const list = mailings.filter(mailing =>
      (!this.props.space || (mailing.space || 'default') === this.props.space) &&
      (this.state.state === undefined || mailing.state === this.state.state) &&
      (this.state.kind === 'all' || Boolean(mailing.test) === (this.state.kind === 'test')) &&
      (!search || mailing.name.toLowerCase().includes(search))
    );
    const key = this.state.sort;
    const value = (mailing: Mailing): string | number => key === 'space' ?
      spaceTitle(this.state.spaces, mailing.space) : (mailing as any)[key] ?? '';
    list.sort((a, b) => {
      const x = value(a);
      const y = value(b);
      const result = typeof x === 'number' && typeof y === 'number' ?
        x - y : String(x).localeCompare(String(y), 'ru');
      return this.state.sortDesc ? -result : result;
    });
    return list;
  }

  private sortMark (key: SortKey) {
    if (key !== this.state.sort) {
      return null;
    }
    return <span aria-hidden='true'>{this.state.sortDesc ? ' ▼' : ' ▲'}</span>;
  }

  private ariaSort (key: SortKey) {
    if (key !== this.state.sort) {
      return undefined;
    }
    return this.state.sortDesc ? 'descending' : 'ascending';
  }

  private handleSort = (key: SortKey) => {
    this.setState(state => ({
      sort: key,
      sortDesc: state.sort === key ? !state.sortDesc : key === 'id'
    }));
  };

  private handleSpace = (event: React.ChangeEvent<HTMLSelectElement>) => {
    this.props.onSpaceFilter(event.currentTarget.value || undefined);
  };

  private handleState = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const value = event.currentTarget.value;
    this.setState({ state: value ? Number(value) as MailingState : undefined });
  };

  private handleMove = async (mailing: Mailing, space: string) => {
    if (!space) {
      return;
    }
    try {
      await moveMailing(mailing.id, space);
      this.props.onSuccess(
        `Рассылка «${mailing.name}» перенесена в «${spaceTitle(this.state.spaces, space)}».`
      );
    } catch (error) {
      this.props.onError(describeError(error, 'Не удалось перенести рассылку'));
    }
    await this.load();
  };

  private load = async () => {
    try {
      const [mailings, spaces] = await Promise.all([getAllMailings(), getAdminSpaces()]);
      this.setState({ mailings, spaces });
    } catch (error) {
      this.props.onError(describeError(error, 'Не удалось загрузить рассылки'));
      this.setState(state => ({ mailings: state.mailings || [] }));
    }
  };
}
