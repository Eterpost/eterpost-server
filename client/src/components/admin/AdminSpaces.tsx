import * as React from 'react';
import {
  addSpaceMember, AdminSpace, createSpace, getAdminSpaces, removeSpace, removeSpaceMember,
  updateSpace
} from '../../api';
import { Button, ButtonType } from '../elements/Button';
import { ConfirmationButton } from '../elements/ConfirmationButton';
import { Loading } from '../elements/Loading';
import { AdminNotify, describeError } from './common';


const SPACE_NAME_PATTERN = /^[a-z0-9][a-z0-9-]{0,31}$/;

export interface AdminSpacesProps extends AdminNotify {
  onShowMailings: (space: string) => void;
}

interface Draft {
  from: string;
  member: string;
  title: string;
}

interface AdminSpacesState {
  drafts: { [name: string]: Draft };
  newSpace: { from: string, name: string, title: string };
  spaces?: AdminSpace[];
}

/**
 * Пространства: название и From, участники, создание и удаление пустых
 */
export class AdminSpaces extends React.Component<AdminSpacesProps, AdminSpacesState> {
  state: AdminSpacesState = {
    drafts: {}, newSpace: { from: '', name: '', title: '' }
  };

  componentDidMount () {
    this.load();
  }

  render () {
    if (!this.state.spaces) {
      return <p className='admin-empty'><Loading>Загрузка…</Loading></p>;
    }
    return (
      <div className='admin-spaces'>
        {this.renderNewSpace()}
        <ul className='admin-cards'>
          {this.state.spaces.map(space => this.renderSpace(space))}
        </ul>
      </div>
    );
  }

  private renderNewSpace () {
    const { from, name, title } = this.state.newSpace;
    const valid = SPACE_NAME_PATTERN.test(name);
    const set = (field: 'from' | 'name' | 'title') =>
      (event: React.ChangeEvent<HTMLInputElement>) => {
        const value = event.currentTarget.value;
        this.setState(state => ({ newSpace: { ...state.newSpace, [field]: value } }));
      };
    return (
      <form className='admin-card admin-new' onSubmit={this.handleCreate}>
        <h3>Новое пространство</h3>
        <div className='admin-fields'>
          <label>
            Имя
            <input className='input' value={name} onChange={set('name')} placeholder='news'
                   aria-describedby='new-space-name-hint' />
          </label>
          <label>
            Название
            <input className='input' value={title} onChange={set('title')} placeholder='Новости' />
          </label>
          <label>
            Отправитель (From)
            <input className='input' value={from} onChange={set('from')}
                   placeholder='Новости <news@example.com>' />
          </label>
        </div>
        <p className='hint' id='new-space-name-hint'>
          Имя — латиница в нижнем регистре, цифры и дефис, до 32 символов; потом его не поменять.
          {name && !valid ? <b className='admin-invalid'> Имя не подходит.</b> : null}
        </p>
        <button className='button primary' type='submit' disabled={!valid}>Создать</button>
      </form>
    );
  }

  private renderSpace (space: AdminSpace) {
    const draft = this.draft(space);
    const changed = draft.title !== (space.title || '') || draft.from !== (space.from || '');
    const setDraft = (field: keyof Draft) => (event: React.ChangeEvent<HTMLInputElement>) => {
      const value = event.currentTarget.value;
      this.setState(state => ({
        drafts: { ...state.drafts, [space.name]: { ...this.draft(space, state), [field]: value } }
      }));
    };
    const count = space.mailingCount;
    return (
      <li key={space.name} className='admin-card'>
        <h3>
          {space.title || space.name} <code>{space.name}</code>
        </h3>
        <div className='admin-fields'>
          <label>
            Название
            <input className='input' value={draft.title} onChange={setDraft('title')} />
          </label>
          <label>
            Отправитель (From)
            <input className='input' value={draft.from} onChange={setDraft('from')}
                   placeholder='адрес сервиса' />
          </label>
          <Button small disabled={!changed} onClick={() => this.handleSave(space)}>
            Сохранить
          </Button>
        </div>
        <p>
          <button className='link-button' onClick={() => this.props.onShowMailings(space.name)}>
            Рассылок: {count}
          </button>
        </p>
        <div className='admin-members'>
          <span className='admin-label'>Участники:</span>
          {space.members.length ? space.members.map(login => (
            <span key={login} className='chip'>
              {login}
              <button className='chip-remove' aria-label={`Убрать ${login}`} title='Убрать'
                      onClick={() => this.handleRemoveMember(space, login)}>×</button>
            </span>
          )) : <span className='hint-inline'>нет — в веб-интерфейсе его видят только админы</span>}
          <form className='admin-add-member' onSubmit={event => this.handleAddMember(event, space)}>
            <input className='input' value={draft.member} onChange={setDraft('member')}
                   placeholder='логин' aria-label={`Логин нового участника «${space.name}»`} />
            <button className='button default small' type='submit' disabled={!draft.member.trim()}>
              Добавить
            </button>
          </form>
        </div>
        {space.name === 'default' ? null : (
          <div className='admin-danger'>
            <ConfirmationButton type={ButtonType.DANGER} typeYes={ButtonType.DANGER}
                                disabled={count > 0} onClick={() => this.handleRemove(space)}>
              Удалить
            </ConfirmationButton>
            {count > 0 ? (
              <span className='hint-inline'>сначала перенесите или удалите его рассылки</span>
            ) : null}
          </div>
        )}
      </li>
    );
  }

  private draft (space: AdminSpace, state = this.state): Draft {
    return state.drafts[space.name] ||
      { from: space.from || '', member: '', title: space.title || '' };
  }

  private async run (action: () => Promise<unknown>, done: string, failed: string) {
    try {
      await action();
      this.props.onSuccess(done);
      return true;
    } catch (error) {
      this.props.onError(describeError(error, failed));
      return false;
    } finally {
      await this.load();
    }
  }

  private handleCreate = async (event: React.FormEvent) => {
    event.preventDefault();
    const { from, name, title } = this.state.newSpace;
    const ok = await this.run(
      () => createSpace({ from: from.trim() || undefined, name, title: title.trim() || undefined }),
      `Пространство «${title || name}» создано.`, 'Не удалось создать пространство'
    );
    if (ok) {
      this.setState({ newSpace: { from: '', name: '', title: '' } });
    }
  };

  private handleSave = async (space: AdminSpace) => {
    const { from, title } = this.draft(space);
    const patch = { from: from.trim(), title: title.trim() };
    const ok = await this.run(() => updateSpace(space.name, patch),
      `Пространство «${title || space.name}» сохранено.`, 'Не удалось сохранить пространство');
    if (ok) {
      this.forgetDraft(space.name);
    }
  };

  private handleRemove = (space: AdminSpace) => {
    this.run(() => removeSpace(space.name), `Пространство «${space.title || space.name}» удалено.`,
      'Не удалось удалить пространство');
  };

  private handleAddMember = async (event: React.FormEvent, space: AdminSpace) => {
    event.preventDefault();
    const login = this.draft(space).member.trim();
    const ok = await this.run(() => addSpaceMember(space.name, login),
      `${login} добавлен в «${space.title || space.name}».`, 'Не удалось добавить участника');
    if (ok) {
      this.setState(state => ({
        drafts: { ...state.drafts, [space.name]: { ...this.draft(space, state), member: '' } }
      }));
    }
  };

  private handleRemoveMember = (space: AdminSpace, login: string) => {
    this.run(() => removeSpaceMember(space.name, login),
      `${login} убран из «${space.title || space.name}».`, 'Не удалось убрать участника');
  };

  private forgetDraft (name: string) {
    this.setState(state => {
      const drafts = { ...state.drafts };
      delete drafts[name];
      return { drafts };
    });
  }

  private load = async () => {
    try {
      this.setState({ spaces: await getAdminSpaces() });
    } catch (error) {
      this.props.onError(describeError(error, 'Не удалось загрузить пространства'));
      this.setState(state => ({ spaces: state.spaces || [] }));
    }
  };
}
