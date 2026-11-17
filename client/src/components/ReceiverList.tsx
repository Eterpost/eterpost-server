import * as React from 'react';
import * as parser from 'papaparse';
import { Receiver } from '../reducers/mailings';
import '../styles/ReceiverList';
import { ConfirmationButton } from './elements/ConfirmationButton';
import { formatDate } from '../formatDate';
import { decodeReceiversFile, parseReceiverRows } from '../../../server/src/receiversCsv';


export const MAX_RECEIVERS = 100;

export interface ReceiverListClickableButton {
  onClick: () => void;
  text: string;
}

export interface ReceiverListLinkButton {
  link: string;
  text: string;
}

export type ReceiverListButton = ReceiverListClickableButton | ReceiverListLinkButton;

export interface ReceiverListProps {
  buttons?: ReceiverListButton[];
  // Рассылка, к которой относится список: номер другой рассылки у ошибки показывается
  mailingId?: number;
  loading?: boolean;
  onChange?: (receivers: Receiver[]) => void;
  onRemove?: (receiver: Receiver) => void;
  // Для исключённых из-за ошибок доставки: вернуть адрес в рассылку
  onRestore?: (receiver: Receiver) => void;
  receivers: Receiver[];
  receiversCount?: number;
  emptyText?: string;
  title?: string;
  unlimited?: boolean;
}

// Статус DSN: 5.x.x — постоянная ошибка (адреса нет, ящик закрыт),
// 4.x.x — временная (ящик переполнен, сервер недоступен)
function describeFailure (receiver: Receiver) {
  if (receiver.spam) {
    return 'отклонено как спам';
  }
  const kind = receiver.status && receiver.status.startsWith('5') ? 'постоянная ошибка' :
    receiver.status && receiver.status.startsWith('4') ? 'временная ошибка' : 'ошибка';
  return `${kind} ${receiver.status}`;
}

interface ReceiverListState {
  // Ошибки последнего загруженного файла: при них список не меняется
  fileErrors?: string[];
}

export class ReceiverList extends React.Component<ReceiverListProps, ReceiverListState> {
  state: ReceiverListState = {};

  static defaultProps = {
    emptyText: 'Список пуст',
    title: 'Получатели'
  };

  private fileInput: HTMLInputElement | null;

  render () {
    const receivers = this.props.unlimited ?
      this.props.receivers :
      this.props.receivers.slice(0, MAX_RECEIVERS);
    const length = this.props.receiversCount || this.props.receivers.length;

    const content = this.props.loading ? (
      <li className='overflow-item'>
        Загрузка…
      </li>
    ) : receivers.map((receiver, index) => {
      const removeButton = this.props.onRemove ? (
        <ConfirmationButton onClick={this.removeReceiver(receiver)}
                            label={'Удалить ' + receiver.email}>
          ✗
        </ConfirmationButton>
      ) : null;
      const restoreButton = this.props.onRestore && receiver.excluded ? (
        <ConfirmationButton onClick={this.restoreReceiver(receiver)}
                            label={'Вернуть ' + receiver.email + ' в рассылку'}>
          ↺
        </ConfirmationButton>
      ) : null;
      const details = [];
      if (receiver.name) {
        details.push(receiver.name);
      }
      if (receiver.periodicDate) {
        details.push('расписание: ' + receiver.periodicDate);
      }
      if (receiver.status || receiver.spam) {
        details.push(describeFailure(receiver));
      }
      if (receiver.date) {
        details.push(formatDate(new Date(receiver.date)));
      }
      if (receiver.mailingId && receiver.mailingId !== this.props.mailingId) {
        details.push(`в рассылке #${receiver.mailingId}`);
      }
      if (receiver.excluded) {
        details.push('исключён из рассылки');
      }
      return (
        <li key={index}>
          <div className='receiver'>
            <span className='receiver-email'>{receiver.email}</span>
            {details.length ? (
              <span className='receiver-details'>{details.join(' · ')}</span>
            ) : null}
            {receiver.diagnosticCode ? (
              <span className='receiver-diagnostic'>{receiver.diagnosticCode}</span>
            ) : null}
          </div>
          {restoreButton}
          {removeButton}
        </li>
      );
    });
    const empty = !this.props.loading && !receivers.length ? (
      <li className='overflow-item'>{this.props.emptyText}</li>
    ) : null;
    const overflow = (
      length > MAX_RECEIVERS && !this.props.unlimited && !this.props.loading
    ) ? (
      <li className='overflow-item'>
        ...и ещё {length - MAX_RECEIVERS} получателей
      </li>
    ) : null;
    return (
      <div className='receiver-list list-block with-border'>
        <h4 className='block-header'>
          {this.props.title} ({length})
          {this.renderActions()}
        </h4>
        {this.renderFileErrors()}
        <ul className='list'>
          {content}
          {empty}
          {overflow}
        </ul>
        <input type='file' onChange={this.changeFile}
               ref={el => this.fileInput = el} style={{ display: 'none' }}/>
      </div>
    );
  }

  private restoreReceiver = (receiver: Receiver) => () => {
    if (this.props.onRestore) {
      this.props.onRestore(receiver);
    }
  };

  private renderFileErrors () {
    const errors = this.state.fileErrors;
    if (!errors) {
      return null;
    }
    return (
      <div className='file-errors' role='alert'>
        <p>Файл не загружен, список получателей не изменился:</p>
        <ul>
          {errors.map((text, index) => <li key={index}>{text}</li>)}
        </ul>
        <button className='action' onClick={() => this.setState({ fileErrors: undefined })}>
          Скрыть
        </button>
      </div>
    );
  }

  private changeFile = async (event: React.FormEvent<HTMLInputElement>) => {
    const file = event.currentTarget.files && event.currentTarget.files[0];
    if (!file) {
      return;
    }
    let rows: unknown[][];
    try {
      rows = await this.readFile(file);
    } catch (error) {
      this.setState({ fileErrors: ['не удалось прочитать файл как CSV'] });
      return;
    }
    const { errors, receivers } = parseReceiverRows(rows);
    if (errors.length) {
      this.setState({ fileErrors: errors });
      return;
    }
    if (!receivers.length) {
      this.setState({ fileErrors: ['в файле нет ни одного получателя'] });
      return;
    }
    this.setState({ fileErrors: undefined });
    if (this.props.onChange) {
      this.props.onChange(receivers as Receiver[]);
    }
  };

  private loadFromFile = () => {
    if (this.fileInput) {
      this.fileInput.value = '';
      this.fileInput.click();
    }
  };

  // Кодировка определяется по содержимому (UTF-8 или windows-1251 из Excel),
  // разделитель («,» или «;») — парсером
  private async readFile (file: File): Promise<unknown[][]> {
    const text = decodeReceiversFile(new Uint8Array(await file.arrayBuffer()));
    const result = parser.parse<unknown[]>(text, { skipEmptyLines: false });
    const fatal = result.errors.find(error => error.type !== 'Delimiter');
    if (fatal) {
      throw new Error(fatal.message);
    }
    return result.data;
  }

  private removeReceiver (receiver: Receiver) {
    return () => {
      if (this.props.onRemove) {
        this.props.onRemove(receiver);
      }
    };
  }

  private renderActions () {
    const stdButtons = this.props.onChange ? (
      <React.Fragment>
        <button className='action' onClick={this.loadFromFile}>
          Из файла
        </button>
        <button className='action' onClick={this.reset}>
          Очистить
        </button>
      </React.Fragment>
    ) : null;

    const buttons = (this.props.buttons || []).map(button => {
      if ('onClick' in button) {
        return (
          <button className='action' key={button.text} onClick={button.onClick}>
            {button.text}
          </button>
        );
      } else {
        return (
          <a href={button.link} key={button.text}>
            <button className='action'>
              {button.text}
            </button>
          </a>
        );
      }
    });

    return (
      <div className='header-actions'>
        {stdButtons}
        {buttons}
      </div>
    );
  }

  private reset = () => {
    if (this.props.onChange) {
      this.props.onChange([]);
    }
  };

}
