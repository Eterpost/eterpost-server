import * as React from 'react';
import {
  AdminKey, ApiKeyRole, ApiKeyRoleType, getAdminKeys, getAdminSpaces, issueKey, revokeKey,
  setKeyRole, Space
} from '../../api';
import { Button, ButtonType } from '../elements/Button';
import { ConfirmationButton } from '../elements/ConfirmationButton';
import { Loading } from '../elements/Loading';
import { AdminNotify, describeError, formatDateTime, spaceTitle } from './common';


const KEY_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

// Роли, которые можно назначить; legacy — только у старых ключей
const ROLE_TYPES: Array<[Exclude<ApiKeyRoleType, 'legacy'>, string]> = [
  ['space', 'Пространство'],
  ['system', 'Системный (службы)'],
  ['admin', 'Админ'],
  ['proxy', 'Прокси (фронт)']
];

const ROLE_HINTS: Record<ApiKeyRoleType, string> = {
  admin: 'все пространства и этот раздел: пространства и ключи',
  legacy: 'старый ключ без роли: видит всё; назначьте роль',
  proxy: 'ключ фронта: через него входят в веб-интерфейс',
  space: 'только рассылки своего пространства — для сайтов и скриптов',
  system: 'все пространства — для mail-sorter и subscription-facade'
};

export type AdminKeysProps = AdminNotify;

interface RoleDraft {
  space: string;
  type: Exclude<ApiKeyRoleType, 'legacy'>;
}

interface AdminKeysState {
  issued?: { key: string, name: string };
  keys?: AdminKey[];
  newKey: { name: string } & RoleDraft;
  roleDrafts: { [name: string]: RoleDraft };
  spaces: Space[];
}

function capitalize (text: string) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function toRole (draft: RoleDraft): ApiKeyRole {
  return draft.type === 'space' ? { space: draft.space, type: 'space' } : { type: draft.type };
}

function sameRole (a: ApiKeyRole, b: ApiKeyRole) {
  return a.type === b.type && (a.type !== 'space' || a.space === b.space);
}

/**
 * Ключи API: список, выпуск (значение показывается один раз), смена роли, отзыв
 */
export class AdminKeys extends React.Component<AdminKeysProps, AdminKeysState> {
  state: AdminKeysState = {
    newKey: { name: '', space: '', type: 'space' }, roleDrafts: {}, spaces: []
  };

  componentDidMount () {
    this.load();
  }

  render () {
    if (!this.state.keys) {
      return <p className='admin-empty'><Loading>Загрузка…</Loading></p>;
    }
    return (
      <div className='admin-keys'>
        {this.state.issued ? this.renderIssued(this.state.issued) : null}
        {this.renderNewKey()}
        <div className='admin-table-wrap'>
          <table className='admin-table'>
            <thead>
              <tr>
                <th>Имя</th><th>Роль</th><th>Создан</th><th>Последнее использование</th><th />
              </tr>
            </thead>
            <tbody>
              {this.state.keys.map(key => this.renderKey(key))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  private renderIssued (issued: { key: string, name: string }) {
    return (
      <div className='admin-issued' role='alert'>
        <h3>Ключ «{issued.name}» выпущен</h3>
        <p>
          <b>Ключ показан один раз.</b> Сохраните его сейчас: сервер хранит только хеш,
          и восстановить ключ нельзя — только выпустить новый.
        </p>
        <div className='admin-issued-key'>
          <input className='input' readOnly value={issued.key} aria-label='Новый ключ'
                 onFocus={event => event.currentTarget.select()} />
          <Button type={ButtonType.PRIMARY} onClick={this.handleCopy}>Скопировать</Button>
          <Button onClick={() => this.setState({ issued: undefined })}>Я сохранил, закрыть</Button>
        </div>
      </div>
    );
  }

  private renderNewKey () {
    const draft = this.state.newKey;
    const nameValid = KEY_NAME_PATTERN.test(draft.name);
    const valid = nameValid && (draft.type !== 'space' || Boolean(draft.space));
    return (
      <form className='admin-card admin-new' onSubmit={this.handleIssue}>
        <h3>Выпустить ключ</h3>
        <div className='admin-fields'>
          <label>
            Имя
            <input className='input' value={draft.name} placeholder='site-sales'
                   onChange={event => this.setNewKey({ name: event.currentTarget.value })} />
          </label>
          {this.renderRoleSelect(draft, value => this.setNewKey(value), 'новый ключ')}
        </div>
        <p className='hint'>
          {capitalize(ROLE_HINTS[draft.type])}.
          Имя — латиница, цифры, «.», «_», «-»; оно видно в журнале.
          {draft.name && !nameValid ? <b className='admin-invalid'> Имя не подходит.</b> : null}
        </p>
        <button className='button primary' type='submit' disabled={!valid}>Выпустить</button>
      </form>
    );
  }

  private renderRoleSelect (
    draft: RoleDraft, onChange: (draft: Partial<RoleDraft>) => void, label: string
  ) {
    return (
      <>
        <label>
          Роль
          <select value={draft.type} aria-label={`Роль: ${label}`}
                  onChange={event => onChange({
                    type: event.currentTarget.value as RoleDraft['type']
                  })}>
            {ROLE_TYPES.map(([type, title]) => <option key={type} value={type}>{title}</option>)}
          </select>
        </label>
        {draft.type === 'space' ? (
          <label>
            Пространство
            <select value={draft.space} aria-label={`Пространство: ${label}`}
                    onChange={event => onChange({ space: event.currentTarget.value })}>
              <option value=''>выберите</option>
              {this.state.spaces.map(space => (
                <option key={space.name} value={space.name}>{space.title || space.name}</option>
              ))}
            </select>
          </label>
        ) : null}
      </>
    );
  }

  private renderRole (role: ApiKeyRole) {
    const title = role.type === 'space' ?
      `Пространство «${spaceTitle(this.state.spaces, role.space)}»` :
      role.type === 'legacy' ? 'Без роли (legacy)' :
        ROLE_TYPES.find(([type]) => type === role.type)?.[1];
    return (
      <span className={'role role-' + role.type} title={ROLE_HINTS[role.type]}>{title}</span>
    );
  }

  private renderKey (key: AdminKey) {
    const draft = this.roleDraft(key);
    const role = toRole(draft);
    const changed = !sameRole(role, key.role) && (draft.type !== 'space' || Boolean(draft.space));
    const setDraft = (value: Partial<RoleDraft>) => this.setState(state => ({
      roleDrafts: { ...state.roleDrafts, [key.name]: { ...this.roleDraft(key, state), ...value } }
    }));
    return (
      <tr key={key.name} className={key.current ? 'current' : ''}>
        <td>
          <code>{key.name}</code>
          {key.current ? <span className='hint-inline'> — ключ этого запроса</span> : null}
        </td>
        <td>{this.renderRole(key.role)}</td>
        <td className='date'>{formatDateTime(key.createdAt)}</td>
        <td className='date'>
          {key.lastUsedAt ? formatDateTime(key.lastUsedAt) : 'не использовался'}
        </td>
        <td className='admin-actions'>
          {key.current ? (
            <span className='hint-inline'>свой ключ менять и отзывать нельзя</span>
          ) : (
            <>
              <div className='admin-role-change'>
                {this.renderRoleSelect(draft, setDraft, `ключ ${key.name}`)}
                <ConfirmationButton disabled={!changed} onClick={() => this.handleRole(key, role)}>
                  Сменить роль
                </ConfirmationButton>
              </div>
              <ConfirmationButton type={ButtonType.DANGER} typeYes={ButtonType.DANGER}
                                  onClick={() => this.handleRevoke(key)}>
                Отозвать
              </ConfirmationButton>
              {key.role.type === 'proxy' ? (
                <span className='hint-inline admin-warning'>
                  через этот ключ входят в веб-интерфейс
                </span>
              ) : null}
            </>
          )}
        </td>
      </tr>
    );
  }

  private roleDraft (key: AdminKey, state = this.state): RoleDraft {
    return state.roleDrafts[key.name] || {
      space: key.role.space || '',
      type: key.role.type === 'legacy' ? 'space' : key.role.type
    };
  }

  private setNewKey (value: Partial<AdminKeysState['newKey']>) {
    this.setState(state => ({ newKey: { ...state.newKey, ...value } }));
  }

  private handleIssue = async (event: React.FormEvent) => {
    event.preventDefault();
    const draft = this.state.newKey;
    try {
      const issued = await issueKey(draft.name, toRole(draft));
      this.setState({ issued, newKey: { name: '', space: '', type: 'space' } });
    } catch (error) {
      this.props.onError(describeError(error, 'Не удалось выпустить ключ'));
    }
    await this.load();
  };

  private handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(this.state.issued!.key);
      this.props.onSuccess('Ключ скопирован.');
    } catch (error) {
      this.props.onError('Не удалось скопировать: выделите ключ и скопируйте вручную.');
    }
  };

  private handleRole = async (key: AdminKey, role: ApiKeyRole) => {
    try {
      await setKeyRole(key.name, role);
      this.props.onSuccess(`Роль ключа «${key.name}» изменена.`);
      this.setState(state => {
        const roleDrafts = { ...state.roleDrafts };
        delete roleDrafts[key.name];
        return { roleDrafts };
      });
    } catch (error) {
      this.props.onError(describeError(error, 'Не удалось сменить роль'));
    }
    await this.load();
  };

  private handleRevoke = async (key: AdminKey) => {
    try {
      await revokeKey(key.name, key.role.type === 'proxy');
      this.props.onSuccess(`Ключ «${key.name}» отозван.`);
    } catch (error) {
      this.props.onError(describeError(error, 'Не удалось отозвать ключ'));
    }
    await this.load();
  };

  private load = async () => {
    try {
      const [keys, spaces] = await Promise.all([getAdminKeys(), getAdminSpaces()]);
      this.setState({ keys, spaces });
    } catch (error) {
      this.props.onError(describeError(error, 'Не удалось загрузить ключи'));
      this.setState(state => ({ keys: state.keys || [] }));
    }
  };
}
