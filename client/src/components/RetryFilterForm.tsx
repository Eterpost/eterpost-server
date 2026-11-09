import * as React from 'react';
import { countRetryReceivers, RetryFilter } from '../api';
import { Button } from './elements/Button';
import { Checkbox } from './elements/Checkbox';
import { TextInput } from './elements/TextInput';
import '../styles/RetryFilterForm';


export interface RetryFilterFormProps {
  // Сколько всего ошибок: при изменении число адресов пересчитывается
  failuresCount?: number;
  mailingId: number;
  onCreate: (filter: RetryFilter) => void;
}

interface RetryFilterFormState {
  // null — ещё считается
  count: number | null;
  countFailed: boolean;
  domains: string;
  spam: boolean;
  status: '' | '4' | '5';
}

// Пауза перед пересчётом, пока вводятся домены
const COUNT_DELAY = 400;

/**
 * Повтор рассылки только по части ошибок доставки: отказы как спам, домены,
 * временные или постоянные ошибки. Показывает, сколько адресов попадёт в повтор
 */
export class RetryFilterForm extends React.Component<RetryFilterFormProps, RetryFilterFormState> {
  state: RetryFilterFormState = {
    count: null, countFailed: false, domains: '', spam: false, status: ''
  };

  private countTimer?: number;
  private countRequest = 0;

  componentDidMount () {
    this.scheduleCount(0);
  }

  componentDidUpdate (prevProps: RetryFilterFormProps) {
    if (prevProps.mailingId !== this.props.mailingId ||
        prevProps.failuresCount !== this.props.failuresCount) {
      this.scheduleCount(0);
    }
  }

  componentWillUnmount () {
    clearTimeout(this.countTimer);
    this.countRequest++;
  }

  render () {
    const id = (name: string) => `retry-filter-${name}-${this.props.mailingId}`;
    const { count } = this.state;
    return (
      <div className='retry-filter'>
        <h4 className='retry-filter-title'>Повтор по части ошибок</h4>
        <div className='retry-filter-fields'>
          <Checkbox value={this.state.spam} onChange={this.handleSpamChange}>
            только отклонённые как спам
          </Checkbox>
          <label className='retry-filter-field' htmlFor={id('status')}>
            <span>Ошибки</span>
            <select id={id('status')} className='input' value={this.state.status}
                    onChange={this.handleStatusChange}>
              <option value=''>все</option>
              <option value='4'>временные (4.x.x)</option>
              <option value='5'>постоянные (5.x.x)</option>
            </select>
          </label>
          <label className='retry-filter-field' htmlFor={id('domains')}>
            <span>Домены</span>
            <TextInput id={id('domains')} value={this.state.domains}
                       onChange={this.handleDomainsChange}
                       placeholder='все; например mail.ru, list.ru, bk.ru, inbox.ru' />
          </label>
        </div>
        <div className='retry-filter-actions'>
          <span className='retry-filter-count' aria-live='polite'>
            {this.state.countFailed ? 'Не удалось посчитать адреса' :
              count === null ? 'Считаем адреса…' : `Адресов в повторе: ${count}`}
          </span>
          <Button disabled={!count} onClick={this.handleCreate}>
            Создать повтор
          </Button>
        </div>
      </div>
    );
  }

  private getFilter (): RetryFilter {
    const domains = this.state.domains.split(/[\s,;]+/).filter(domain => domain.length);
    return {
      ...(domains.length ? { domains } : {}),
      ...(this.state.spam ? { spam: true } : {}),
      ...(this.state.status ? { status: this.state.status } : {})
    };
  }

  private handleCreate = () => {
    this.props.onCreate(this.getFilter());
  };

  private handleDomainsChange = (domains: string) => {
    this.setState({ domains }, () => this.scheduleCount(COUNT_DELAY));
  };

  private handleSpamChange = (spam: boolean) => {
    this.setState({ spam }, () => this.scheduleCount(0));
  };

  private handleStatusChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const status = event.currentTarget.value as RetryFilterFormState['status'];
    this.setState({ status }, () => this.scheduleCount(0));
  };

  private scheduleCount (delay: number) {
    clearTimeout(this.countTimer);
    this.setState({ count: null, countFailed: false });
    this.countTimer = setTimeout(this.count, delay) as any;
  }

  // Ответ на устаревший запрос (фильтр успели поменять) не показываем
  private count = async () => {
    const request = ++this.countRequest;
    try {
      const count = await countRetryReceivers(this.props.mailingId, this.getFilter());
      if (request === this.countRequest) {
        this.setState({ count });
      }
    } catch (error) {
      if (request === this.countRequest) {
        this.setState({ countFailed: true });
      }
    }
  };
}
