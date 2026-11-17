import * as React from 'react';
import { Mailing, Receiver } from '../reducers/mailings';
import '../styles/MailingDetailView';
import { MailingStateView } from './MailingStateView';
import { MailingState } from '../../../server/src/MailingState';
import { Button, ButtonType } from './elements/Button';
import { ConfirmationButton } from './elements/ConfirmationButton';
import { FormGroup } from './elements/FormGroup';
import { TextInput } from './elements/TextInput';
import pick from 'lodash-es/pick';
import { LetterEditor } from 'eterpost-letter-editor';
import 'eterpost-letter-editor/style.css';
import { ReceiverList } from './ReceiverList';
import { FailureList } from './FailureList';
import { Checkbox } from './elements/Checkbox';
import { formatDate } from '../formatDate';
import { EmailPreview, getReceiverFields, RetryFilter } from '../api';
import { receiverFieldOptions } from '../receiverFieldOptions';
import { uploadImage } from '../uploadImage';
import { collectFieldStats, ReceiverFieldStats } from 'eterpost-letter-editor/fields';
import { EmailPreviewView } from './EmailPreviewView';
import { fromPlaceholder } from './AddForm';
import { AttachmentList } from './AttachmentList';


const REFRESH_INTERVAL = 1000;

const editableFields = {
  from: 'Отправитель (From)',
  html: 'Текст рассылки',
  listUnsubscribe: 'Кнопка «Отписаться» (List-Unsubscribe)',
  name: 'Название',
  openForSubscription: 'Возможность подписки через API',
  receivers: 'Получатели',
  receiversChanged: '',
  receiversCount: 'Количество получателей',
  replyTo: 'Обратный адрес (Reply-To)',
  subject: 'Тема письма',
  test: 'Пробная рассылка',
  tracking: 'Отслеживание открытий и переходов'
};
const keys = Object.keys(editableFields) as Array<keyof MailingEditData>;

export interface MailingEditData {
  from: string;
  html: string;
  listUnsubscribe: boolean;
  name: string;
  openForSubscription: boolean;
  receivers: Receiver[];
  receiversCount: number;
  receiversChanged: boolean;
  replyTo: string;
  subject: string;
  test: boolean;
  tracking: boolean;
}

export interface MailingDetailViewProps {
  mailing: Mailing;
  onAddAttachments?: (mailing: Mailing, files: File[]) => Promise<void>;
  onDeleteAttachment?: (mailing: Mailing, id: string) => void;
  onClone?: (mailing: Mailing) => void;
  onCreateRetry?: (mailing: Mailing, filter?: RetryFilter) => void;
  onDelete: (mailing: Mailing) => void;
  onRefresh?: (mailing: Mailing) => void;
  onRefreshReceiversList?: (mailing: Mailing) => void;
  onRefreshFailedReceivers?: (mailing: Mailing) => Promise<void>;
  onRestoreExcluded?: (mailing: Mailing, emails?: string[]) => Promise<void>;
  onRemoveReceiver?: (mailing: Mailing, receiver: Receiver) => void;
  onPreview?: (mailing: Mailing, address: string) => Promise<EmailPreview | null>;
  onSendTestEmail?: (mailing: Mailing, address: string, receiver?: string) => void;
  onStart?: (mailing: Mailing) => void;
  onStop?: (mailing: Mailing) => void;
  onUpdate?: (mailing: Mailing, saveData: MailingEditData) => void;
  // Адрес пространства рассылки: подсказка в пустом поле From
  spaceFrom?: string;
}

interface MailingDetailViewState {
  changed: boolean;
  // Сводка сервера по полям сохранённых получателей
  fieldStats?: ReceiverFieldStats;
  fields: MailingEditData;
  mailingId: number;
  preview?: EmailPreview;
  previewEmail: string;
  testEmail: string;
}

function initState (mailing: Mailing) {
  return {
    changed: false,
    fieldStats: undefined,
    fields: pick(mailing, keys) as MailingEditData,
    mailingId: mailing.id,
    preview: undefined,
    previewEmail: '',
    testEmail: ''
  };
}

export class MailingDetailView extends React.Component<
  MailingDetailViewProps, MailingDetailViewState
> {
  public static getDerivedStateFromProps (
    nextProps: MailingDetailViewProps, prevState: MailingDetailViewState
  ) {
    if (nextProps.mailing.id !== prevState.mailingId) {
      return initState(nextProps.mailing);
    }

    return null;
  }

  private handlers: { [name: string]: (value: any) => void };
  // Сводка по новому, ещё не сохранённому списку получателей
  private localStats?: { receivers: Receiver[]; result: ReceiverFieldStats };
  private refreshInterval: number;

  constructor (props: MailingDetailViewProps) {
    super(props);
    this.state = initState(props.mailing);
    this.handlers = {};
    for (const key of keys) {
      this.handlers[key] = this.getHandler(key);
    }
  }

  componentDidMount () {
    this.refreshInterval = setInterval(this.refresh, REFRESH_INTERVAL) as any;
    this.loadFieldStats();
  }

  componentDidUpdate (prevProps: MailingDetailViewProps) {
    if (prevProps.mailing.id !== this.props.mailing.id) {
      this.loadFieldStats();
    }
  }

  componentWillUnmount () {
    clearInterval(this.refreshInterval);
  }

  render () {
    const { mailing } = this.props;
    const canEdit = this.canEdit();
    const retryButton = mailing.failedReceiversCount ? (
      <Button disabled={!canEdit} onClick={this.handleCreateRetry}>
        Повторить для адресов с ошибками
      </Button>
    ) : null;
    const downloadButton = {
      link: API_URL + `/mailings/${mailing.id}/receivers?format=csv`,
      text: 'Скачать'
    };
    const refreshButton = {
      onClick: this.refreshReceiversList,
      text: 'Обновить'
    };
    const count = (value?: number) => typeof value === 'number' ? ` (${value})` : '';
    const listTabs = [
      {
        content: (
          <ReceiverList receivers={this.state.fields.receivers}
                        receiversCount={this.state.fields.receiversCount}
                        onRemove={this.removeReceiver}
                        buttons={[ downloadButton, refreshButton ]}
                        onChange={this.handlers.receivers} key='1' />
        ),
        name: 'Получатели' + count(this.state.fields.receiversCount)
      },
      {
        content: (
          <FailureList
            mailing={mailing} onReload={this.refreshFailedReceivers}
            onCreateRetry={this.props.onCreateRetry && canEdit ? this.createRetry : undefined}
            onRestore={this.props.onRestoreExcluded ? this.restoreExcluded : undefined} />
        ),
        name: 'Ошибки доставки' + count(mailing.failedReceiversCount)
      }
    ];
    const from = typeof this.state.fields.from === 'string' ? this.state.fields.from : '';
    const replyTo = typeof this.state.fields.replyTo === 'string' ? this.state.fields.replyTo : '';
    const id = (name: string) => `mailing-${mailing.id}-${name}`;
    const stats = this.fieldStats();
    return (
      <div className='mailing-detail-view'>
        <h2 className='header'>{mailing.name}</h2>
        <dl className='details'>
          <dt>Состояние</dt>
          <dd>
            <MailingStateView state={mailing.state} />
            {mailing.state === MailingState.PAUSED && mailing.autoResumeAt ?
              `, продолжится ${formatDate(new Date(mailing.autoResumeAt))}` : null}
            {mailing.pendingRetries ?
              `, повтор для ${mailing.pendingRetries} адр. после временного отказа` +
              (mailing.nextRetryAt ?
                `, ближайший ${formatDate(new Date(mailing.nextRetryAt))}` : '')
              : null}
          </dd>

          <dt>Отправлено писем</dt>
          <dd>{mailing.sentCount}</dd>

          <dt>Уведомлений о недоставке</dt>
          <dd>{mailing.undeliveredCount}</dd>

          {mailing.tracking ? <dt>Открыли письмо</dt> : null}
          {mailing.tracking ? <dd>{mailing.opened || 0}</dd> : null}
          {mailing.tracking ? <dt>Перешли по ссылкам</dt> : null}
          {mailing.tracking ? <dd>{mailing.clicked || 0}</dd> : null}

          {mailing.creationDate ? <dt>Создана</dt> : null}
          {mailing.creationDate ? <dd>{formatDate(mailing.creationDate)}</dd> : null}

          <dt>List-Id</dt>
          <dd className='technical'>{mailing.listId}</dd>
        </dl>

        <div className='options'>
          <Checkbox value={this.state.fields.listUnsubscribe}
                    onChange={this.handlers.listUnsubscribe}>
            Кнопка «Отписаться» в почтовых программах (заголовок List-Unsubscribe)
          </Checkbox>
          <Checkbox value={this.state.fields.openForSubscription}
                    onChange={this.handlers.openForSubscription}>
            Подписка через API открыта
          </Checkbox>
          <Checkbox value={this.state.fields.tracking}
                    onChange={this.handlers.tracking}>
            Отслеживать открытия и переходы по ссылкам
          </Checkbox>
          <Checkbox value={Boolean(this.state.fields.test)}
                    onChange={this.handlers.test}>
            Пробная
          </Checkbox>
        </div>

        <div className='actions'>
          <div className='button-group'>
            {this.renderFirstButton()}
            {this.state.changed ? (
              <Button onClick={this.handleRevert}>Отменить изменения</Button>
            ) : null}
            <Button disabled={!canEdit} onClick={this.handleClone}>
              Дублировать
            </Button>
            {retryButton}
            <a className='button default' download
               href={API_URL + `/mailings/${mailing.id}/results?format=csv`}>
              Скачать результаты
            </a>
            <div className='spacer' />
            <ConfirmationButton
              disabled={!canEdit} onClick={this.handleDelete}
              type={ButtonType.DANGER} typeYes={ButtonType.DANGER}>
              Удалить рассылку
            </ConfirmationButton>
          </div>
          {mailing.state === MailingState.RUNNING ? (
            <p className='hint'>
              Пока рассылка выполняется, её нельзя менять: сначала приостановите её.
            </p>
          ) : null}
        </div>

        <div className='form'>
          <FormGroup inline title='Название' htmlFor={id('name')}>
            <TextInput id={id('name')} value={this.state.fields.name}
                       onChange={this.handlers.name} />
          </FormGroup>
          <FormGroup inline title='Тема письма' htmlFor={id('subject')}>
            <TextInput id={id('subject')} value={this.state.fields.subject}
                       onChange={this.handlers.subject} />
          </FormGroup>
          <FormGroup inline title='Отправитель (From)' htmlFor={id('from')}>
            <TextInput id={id('from')} value={from} onChange={this.handlers.from}
                       placeholder={fromPlaceholder(this.props.spaceFrom)} />
          </FormGroup>
          <FormGroup inline title='Ответы (Reply-To)' htmlFor={id('reply-to')}>
            <TextInput id={id('reply-to')} value={replyTo} onChange={this.handlers.replyTo}
                       placeholder='по умолчанию — на адрес отправителя' />
          </FormGroup>
          <FormGroup stretch fraction={2}>
            <LetterEditor onChange={this.handlers.html} html={this.state.fields.html}
                          extraTabs={listTabs} fields={receiverFieldOptions(stats)}
                          stats={stats} subject={this.state.fields.subject}
                          uploadImage={uploadImage} />
          </FormGroup>
        </div>

        <div className='attachments'>
          <AttachmentList attachments={mailing.attachments || []} mailingId={mailing.id}
                          maxSize={mailing.attachmentsMaxSize}
                          readOnly={!canEdit || !this.props.onAddAttachments}
                          onUpload={this.handleAddAttachments}
                          onDelete={this.handleDeleteAttachment} />
        </div>

        <div className='test-email'>
          <h3 className='test-email-title'>Проверка письма</h3>
          <FormGroup inline title='Данные получателя' htmlFor={id('preview-email')}>
            <TextInput id={id('preview-email')} type='email' value={this.state.previewEmail}
                       onChange={this.handleChangePreviewEmail}
                       placeholder='адрес из списка получателей рассылки' />
          </FormGroup>
          <FormGroup inline title='Свой адрес' htmlFor={id('test-email')}>
            <TextInput id={id('test-email')} type='email' value={this.state.testEmail}
                       onChange={this.handleChangeTestEmail}
                       placeholder='куда прислать пробное письмо' />
          </FormGroup>
          <div className='horizontal-group test-email-actions'>
            <Button disabled={!this.state.previewEmail.length}
                    onClick={this.handlePreview}>
              Показать предпросмотр
            </Button>
            <Button disabled={!this.state.testEmail.length || !canEdit}
                    onClick={this.handleSendTestEmail}>
              Отправить пробное письмо себе
            </Button>
          </div>
          <ul className='hint test-email-help'>
            <li>
              <b>Предпросмотр</b> — {this.state.previewEmail.length
                ? `письмо так, как его получит ${this.state.previewEmail}. Ничего не отправляется.`
                : 'укажите адрес в «Данные получателя». Ничего не отправляется.'}
            </li>
            <li>
              <b>Пробное письмо</b> — {testEmailHint(this.state.testEmail, this.state.previewEmail)}
            </li>
          </ul>
          {this.state.changed ? (
            <p className='hint'>
              Сервер собирает сохранённое письмо: несохранённые изменения в предпросмотр
              и пробное письмо не попадут.
            </p>
          ) : null}
        </div>

        {this.state.preview ? (
          <EmailPreviewView preview={this.state.preview} onClose={this.handleClosePreview} />
        ) : null}
      </div>
    );
  }


  private fieldStats (): ReceiverFieldStats | undefined {
    const { receivers, receiversChanged } = this.state.fields;
    if (!receiversChanged) {
      return this.state.fieldStats;
    }
    if (this.localStats?.receivers !== receivers) {
      this.localStats = { receivers, result: collectFieldStats(receivers) };
    }
    return this.localStats.result;
  }

  private loadFieldStats = async () => {
    const mailingId = this.props.mailing.id;
    try {
      const fieldStats = await getReceiverFields(mailingId);
      // Пока считалось, могли выбрать другую рассылку
      if (this.state.mailingId === mailingId) {
        this.setState({ fieldStats });
      }
    } catch (error) {
      // Без сводки нет только подсказок о пустых полях
    }
  };

  private handleAddAttachments = async (files: File[]) => {
    await this.props.onAddAttachments?.(this.props.mailing, files);
  };

  private handleDeleteAttachment = (id: string) => {
    this.props.onDeleteAttachment?.(this.props.mailing, id);
  };

  private canEdit () {
    return !this.props.mailing.locked && this.props.mailing.state !== MailingState.RUNNING;
  }

  private getHandler (field: keyof MailingEditData) {
    if (field === 'receivers') {
      return (value: ReadonlyArray<Receiver>) => {
        this.setState({
          changed: true,
          fields: Object.assign({}, this.state.fields, {
            receivers: value,
            receiversChanged: true,
            receiversCount: value.length
          })
        });
      };
    }

    return (value: string) => {
      if (this.state.fields[field] !== value) {
        this.setState({
          changed: true,
          fields: Object.assign({}, this.state.fields, {
            [field]: value
          })
        });
      }
    };
  }

  private handleChangePreviewEmail = (value: string) => {
    this.setState({
      previewEmail: value
    });
  };

  private handleClosePreview = () => {
    this.setState({
      preview: undefined
    });
  };

  private handlePreview = async () => {
    if (!this.props.onPreview) {
      return;
    }
    const mailingId = this.props.mailing.id;
    const preview = await this.props.onPreview(this.props.mailing, this.state.previewEmail);
    // Пока собиралось письмо, могли выбрать другую рассылку
    if (preview && this.state.mailingId === mailingId) {
      this.setState({ preview });
    }
  };

  private handleChangeTestEmail = (value: string) => {
    this.setState({
      testEmail: value
    });
  };

  private handleClone = () => {
    if (this.props.onClone) {
      this.props.onClone(this.props.mailing);
    }
  };

  private createRetry = (filter: RetryFilter) => {
    if (this.props.onCreateRetry) {
      this.props.onCreateRetry(this.props.mailing, filter);
    }
  };

  private handleCreateRetry = () => {
    if (this.props.onCreateRetry) {
      this.props.onCreateRetry(this.props.mailing);
    }
  };

  private handleDelete = () => {
    this.props.onDelete(this.props.mailing);
  };

  private handleRevert = () => {
    this.setState(initState(this.props.mailing));
  };

  private handleSave = () => {
    if (this.props.onUpdate) {
      this.props.onUpdate(this.props.mailing, this.state.fields);
      this.setState({
        changed: false
      });
    }
  };

  private handleSendTestEmail = () => {
    if (this.props.onSendTestEmail) {
      this.props.onSendTestEmail(
        this.props.mailing, this.state.testEmail, this.state.previewEmail || undefined
      );
    }
  };

  private handleStart = () => {
    if (this.props.onStart) {
      this.props.onStart(this.props.mailing);
    }
  };

  private handleStop = () => {
    if (this.props.onStop) {
      this.props.onStop(this.props.mailing);
    }
  };

  private refresh = () => {
    if (this.props.onRefresh) {
      this.props.onRefresh(this.props.mailing);
    }
  };

  private refreshReceiversList = async () => {
    if (this.props.onRefreshReceiversList) {
      await this.props.onRefreshReceiversList(this.props.mailing);
      this.setState({
        fields: {
          ...this.state.fields,
          receivers: this.props.mailing.receivers!,
          receiversCount: this.props.mailing.receiversCount!
        }
      });
      this.loadFieldStats();
    }
  };

  private restoreExcluded = async (emails?: string[]) => {
    if (this.props.onRestoreExcluded) {
      await this.props.onRestoreExcluded(this.props.mailing, emails);
      // Вкладка «Получатели» показывает копию списка в форме: обновляем её
      await this.refreshReceiversList();
    }
  };

  private refreshFailedReceivers = () => {
    if (this.props.onRefreshFailedReceivers) {
      this.props.onRefreshFailedReceivers(this.props.mailing);
    }
  };

  private removeReceiver = (receiver: Receiver) => {
    if (this.props.onRemoveReceiver) {
      this.props.onRemoveReceiver(this.props.mailing, receiver);
      this.setState({
        fields: {
          ...this.state.fields,
          receivers: this.state.fields.receivers.filter(r => r.email !== receiver.email),
          receiversCount: this.state.fields.receiversCount - 1
        }
      });
      setTimeout(this.loadFieldStats, REFRESH_INTERVAL);
    }
  };

  private renderFirstButton () {
    if (this.state.changed) {
      return (
        <Button disabled={!this.canEdit()} onClick={this.handleSave}
                type={ButtonType.PRIMARY}>
          Сохранить изменения
        </Button>
      );
    } else {
      return this.renderStateButton();
    }
  }

  private renderStateButton () {
    const { mailing } = this.props;
    if (mailing.state === MailingState.FINISHED) {
      return (
        <Button disabled={mailing.locked} onClick={this.handleStart}
                type={ButtonType.PRIMARY}>
          Перезапустить
        </Button>
      );
    } else if (mailing.state === MailingState.RUNNING) {
      return (
        <Button disabled={mailing.locked} onClick={this.handleStop}
                type={ButtonType.PRIMARY}>
          Приостановить
        </Button>
      );
    } else {
      return (
        <Button disabled={mailing.locked || this.state.changed}
                onClick={this.handleStart} type={ButtonType.PRIMARY}>
          Запустить
        </Button>
      );
    }
  }
}


/**
 * Что сделает кнопка пробного письма при текущих полях
 */
function testEmailHint (testEmail: string, receiverEmail: string): string {
  const to = testEmail || 'свой адрес';
  if (receiverEmail) {
    return `придёт на ${to} с данными ${receiverEmail}, как его увидит этот получатель. ` +
      `Самому ${receiverEmail} ничего не отправляется.`;
  }
  return `придёт на ${to} без данных получателя: подстановки (имя и т. п.) будут пустыми. ` +
    'Чтобы письмо пришло заполненным, укажите адрес в «Данные получателя».';
}
