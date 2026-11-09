import * as React from 'react';
import { Tab, Tabs, TabList, TabPanel } from 'react-tabs';
import { EmailPreview } from '../api';
import { Button } from './elements/Button';
import '../styles/EmailPreviewView';


export interface EmailPreviewViewProps {
  onClose: () => void;
  preview: EmailPreview;
}

function formatAddress (address: string | { address: string; name: string }) {
  return typeof address === 'string' ? address : `${address.name} <${address.address}>`;
}

/**
 * Письмо, собранное сервером для получателя: заголовки, HTML и текстовая версия
 */
export function EmailPreviewView ({ onClose, preview }: EmailPreviewViewProps) {
  const fields: Array<[string, string | undefined]> = [
    ['From', preview.from],
    ['Sender', preview.sender],
    ['To', preview.to.map(formatAddress).join(', ')],
    ['Reply-To', preview.replyTo],
    ['Тема', preview.subject]
  ];
  const headers = Object.entries(preview.headers);
  return (
    <div className='email-preview'>
      <div className='email-preview-bar'>
        <h3>Предпросмотр письма</h3>
        <Button onClick={onClose}>Закрыть</Button>
      </div>
      {preview.receiverFound ? null : (
        <p className='hint'>
          Адреса нет среди получателей: письмо собрано без имени, кода и данных
          получателя, как пробное.
        </p>
      )}
      <dl className='email-preview-fields'>
        {fields.filter(([, value]) => value).map(([name, value]) => (
          <React.Fragment key={name}>
            <dt>{name}</dt>
            <dd>{value}</dd>
          </React.Fragment>
        ))}
      </dl>
      <Tabs>
        <TabList>
          <Tab>HTML</Tab>
          <Tab>Текст</Tab>
          <Tab>Заголовки</Tab>
        </TabList>
        <TabPanel>
          {/* sandbox без разрешений: скрипты и формы письма не выполняются */}
          <iframe className='email-preview-html' sandbox='' srcDoc={preview.html || ''}
                  title='HTML-версия письма' />
        </TabPanel>
        <TabPanel>
          <pre className='email-preview-text'>{preview.text || ''}</pre>
        </TabPanel>
        <TabPanel>
          <pre className='email-preview-text'>
            {headers.map(([name, value]) => `${name}: ${value}`).join('\n')}
          </pre>
        </TabPanel>
      </Tabs>
    </div>
  );
}
