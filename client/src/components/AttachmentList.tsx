import * as React from 'react';
import '../styles/AttachmentList';
import { AttachmentInfo, attachmentUrl } from '../api';
import { Button } from './elements/Button';


export interface AttachmentListProps {
  attachments: AttachmentInfo[];
  mailingId: number;
  maxSize?: number;
  onDelete?: (id: string) => void;
  onUpload?: (files: File[]) => Promise<void> | void;
  // Рассылка выполняется или заблокирована: вложения только смотреть
  readOnly: boolean;
}

interface AttachmentListState {
  uploading: boolean;
}

export function formatSize (size: number): string {
  if (size < 1024) {
    return `${size} Б`;
  }
  if (size < 1024 * 1024) {
    return `${Math.round(size / 1024)} КБ`;
  }
  return `${(size / 1024 / 1024).toFixed(1).replace('.', ',')} МБ`;
}

/**
 * Вложения рассылки: уходят каждому получателю
 */
export class AttachmentList extends React.Component<AttachmentListProps, AttachmentListState> {
  state: AttachmentListState = { uploading: false };
  private input: HTMLInputElement | null = null;

  render () {
    const { attachments, maxSize, mailingId, readOnly } = this.props;
    const total = attachments.reduce((sum, attachment) => sum + attachment.size, 0);
    return (
      <div className='attachment-list'>
        <div className='attachment-list-header'>
          <h3 className='attachment-list-title'>Вложения</h3>
          {readOnly ? null : (
            <>
              <input type='file' multiple hidden ref={input => { this.input = input; }}
                     onChange={this.handleFiles} />
              <Button disabled={this.state.uploading} onClick={this.chooseFiles}>
                {this.state.uploading ? 'Загрузка…' : 'Добавить файл'}
              </Button>
            </>
          )}
        </div>
        {attachments.length ? (
          <ul className='attachment-items'>
            {attachments.map(attachment => (
              <li key={attachment.id}>
                <a href={attachmentUrl(mailingId, attachment.id)} download={attachment.filename}>
                  {attachment.filename}
                </a>
                <span className='attachment-size'>{formatSize(attachment.size)}</span>
                {readOnly ? null : (
                  <button type='button' className='attachment-delete'
                          title={`Удалить ${attachment.filename}`}
                          aria-label={`Удалить ${attachment.filename}`}
                          onClick={() => this.props.onDelete?.(attachment.id)}>
                    ✕
                  </button>
                )}
              </li>
            ))}
          </ul>
        ) : null}
        <p className='hint'>
          {attachments.length ? `Всего ${formatSize(total)}. ` : 'Вложений нет. '}
          Вложения уходят каждому получателю
          {maxSize ? `, всего до ${formatSize(maxSize)} на письмо` : ''}.
        </p>
      </div>
    );
  }

  private chooseFiles = () => {
    this.input?.click();
  };

  private handleFiles = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.currentTarget.files || []);
    // Тот же файл можно выбрать снова
    event.currentTarget.value = '';
    if (!files.length || !this.props.onUpload) {
      return;
    }
    this.setState({ uploading: true });
    try {
      await this.props.onUpload(files);
    } finally {
      this.setState({ uploading: false });
    }
  };
}
