import * as React from 'react';
import '../styles/FailureList';
import { ReceiverList, ReceiverListButton } from './ReceiverList';
import { Mailing, Receiver } from '../reducers/mailings';
import { RetryFilter } from '../api';
import { RetryFilterForm } from './RetryFilterForm';


export interface FailureListProps {
  mailing: Mailing;
  // Создать повтор по ошибкам, подходящим под фильтр
  onCreateRetry?: (filter: RetryFilter) => void;
  onReload: () => Promise<void> | void;
  // Вернуть в рассылку исключённые адреса: все (без аргумента) или один
  onRestore?: (emails?: string[]) => void;
}

export class FailureList extends React.Component<FailureListProps> {
  componentDidMount () {
    if (!this.props.mailing.failedReceivers) {
      this.reload(false);
    }
  }

  componentDidUpdate (prevProps: FailureListProps) {
    if (prevProps.mailing.id !== this.props.mailing.id) {
      this.reload(false);
    }
  }

  render () {
    const { mailing } = this.props;
    const downloadButton = {
      link: API_URL + `/mailings/${mailing.id}/failed-receivers?format=csv`,
      text: 'Скачать'
    };
    const reloadFailuresButton = {
      onClick: this.reload,
      text: 'Обновить'
    };
    const buttons: ReceiverListButton[] = [reloadFailuresButton, downloadButton];
    const hasExcluded = (mailing.failedReceivers || []).some(receiver => receiver.excluded);
    if (this.props.onRestore && hasExcluded) {
      buttons.push({ onClick: this.restoreAll, text: 'Вернуть исключённых' });
    }
    const hasFailures = Boolean(mailing.failedReceiversCount);
    return (
      <div className='failure-list'>
        <ReceiverList receivers={mailing.failedReceivers || []}
                      receiversCount={mailing.failedReceiversCount}
                      loading={mailing.loadingFailedReceivers}
                      mailingId={mailing.id}
                      emptyText='Ошибок доставки нет'
                      onRestore={this.props.onRestore ? this.restoreOne : undefined}
                      title='Ошибки доставки' buttons={buttons} />
        {this.props.onCreateRetry && hasFailures ? (
          <RetryFilterForm mailingId={mailing.id} failuresCount={mailing.failedReceiversCount}
                           onCreate={this.props.onCreateRetry} />
        ) : null}
      </div>
    );
  }

  private restoreAll = () => {
    if (this.props.onRestore) {
      this.props.onRestore();
    }
  };

  private restoreOne = (receiver: Receiver) => {
    if (this.props.onRestore) {
      this.props.onRestore([receiver.email]);
    }
  };

  private reload = async (force: boolean = true) => {
    const { mailing } = this.props;
    if (!force && (mailing.failedReceivers || mailing.loadingFailedReceivers)) {
      return;
    }

    await this.props.onReload();
  };
}
