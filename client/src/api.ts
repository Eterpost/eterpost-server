import queryString from 'query-string';
import { Mailing, Receiver } from './reducers/mailings';
import { MailingCreateData } from './components/AddForm';
import { MAX_RECEIVERS } from './components/ReceiverList';
import { SorterStatus } from '../../server/src/RedisSorterStatusRepository';


type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';

const SPACE_HEADER = 'X-Eterpost-Space';

// Пространство, в котором работает пользователь: уходит в каждом запросе к API
let currentSpace: string | undefined;

export function setCurrentSpace (space: string | undefined) {
  currentSpace = space;
}

// Ошибка ответа API: code — машинный код ошибки сервера (например, SPACE_FORBIDDEN)
export class ApiError extends Error {
  constructor (message: string, public status: number, public code?: string) {
    super(message);
    this.name = 'ApiError';
  }
}

export async function apiRequest (
  endpoint: string, method: HttpMethod = 'GET', queryParams?: any, data?: any,
  withSpace = true
): Promise<any> {
  const headers: { [name: string]: string } = {
    'content-type': 'application/json'
  };
  if (withSpace && currentSpace) {
    headers[SPACE_HEADER] = currentSpace;
  }
  const requestConfig: any = {
    credentials: 'include',
    headers,
    method
  };

  if (queryParams !== undefined && queryParams !== null) {
    endpoint += '?' + queryString.stringify(queryParams);
  }

  if (data !== undefined) {
    requestConfig.body = JSON.stringify(data);
  }

  const response = await fetch(API_URL + endpoint, requestConfig);

  const jsonResponse = await response.json();

  if (!response.ok || !jsonResponse.success) {
    const apiError = new ApiError(
      `Endpoint ${endpoint} replied with ${response.status}: ${jsonResponse.error}`,
      response.status, jsonResponse.code
    );
    for (const listener of errorListeners) {
      listener(apiError);
    }
    throw apiError;
  }

  return jsonResponse.data;
}

type ErrorListener = (error: ApiError) => void;

const errorListeners: ErrorListener[] = [];

// Слушатель ошибок всех запросов: так приложение узнаёт, что доступ к пространству пропал
export function onApiError (listener: ErrorListener) {
  errorListeners.push(listener);
}

export interface CreateResponse {
  id: number;
  listId: string;
}

export interface ReceiverList {
  list: Receiver[];
  total: number;
}

export function cloneMailing (sourceId: number): Promise<CreateResponse> {
  return apiRequest('/mailings', 'POST', null, { sourceId });
}

export async function createMailing (mailing: MailingCreateData): Promise<CreateResponse> {
  return apiRequest('/mailings', 'POST', null, mailing);
}

export interface RetryFilter {
  domains?: string[];
  spam?: boolean;
  status?: '4' | '5';
}

export function createRetryMailing (
  sourceId: number, filter?: RetryFilter
): Promise<CreateResponse> {
  return apiRequest('/mailings/create-retry', 'POST', null, { filter, sourceId });
}

// Сколько адресов попадёт в повтор с этим фильтром
export async function countRetryReceivers (
  sourceId: number, filter?: RetryFilter
): Promise<number> {
  const { count } = await apiRequest('/mailings/create-retry', 'POST', null, {
    dryRun: true, filter, sourceId
  });
  return count;
}

export function deleteMailing (id: number): Promise<void> {
  return apiRequest('/mailings/' + id, 'DELETE');
}

export function deleteReceiver (mailingId: number, receiver: string): Promise<void> {
  return apiRequest('/mailings/' + mailingId + '/receivers/' + receiver, 'DELETE');
}

export async function getMailingById (id: number): Promise<Mailing> {
  const mailing = await apiRequest(`/mailings/${id}`);
  if (mailing.creationDate) {
    mailing.creationDate = new Date(mailing.creationDate * 1000);
  }
  return mailing;
}

export type MailingKind = 'live' | 'test' | 'all';

export const MAILING_KINDS: MailingKind[] = ['live', 'test', 'all'];

export function getMailings (kind: MailingKind): Promise<Mailing[]> {
  return apiRequest('/mailings', 'GET', { kind });
}

export interface Space {
  from?: string;
  name: string;
  title?: string;
}

// Без X-Eterpost-Space: с ним сервер вернул бы только текущее пространство
export function getSpaces (): Promise<Space[]> {
  return apiRequest('/spaces', 'GET', null, undefined, false);
}

export type SorterStatusView = SorterStatus & { stale: boolean };

export function getSorterStatus (): Promise<SorterStatusView | null> {
  return apiRequest('/sorter/status');
}

export function getFailedReceivers (id: number): Promise<ReceiverList> {
  return apiRequest(`/mailings/${id}/failed-receivers?limit=${MAX_RECEIVERS}`);
}

export function getReceivers (id: number): Promise<ReceiverList> {
  return apiRequest(`/mailings/${id}/receivers?limit=${MAX_RECEIVERS}`);
}

export interface EmailPreview {
  from: string;
  headers: { [name: string]: string };
  html?: string;
  receiver: { email: string; name?: string };
  receiverFound: boolean;
  replyTo?: string;
  sender?: string;
  subject: string;
  text?: string;
  to: Array<string | { address: string; name: string }>;
}

export function previewEmail (mailingId: number, email: string): Promise<EmailPreview> {
  return apiRequest(`/mailings/${mailingId}/preview`, 'POST', null, { email });
}

export function restoreExcluded (
  mailingId: number, emails?: string[]
): Promise<{ restored: string[] }> {
  return apiRequest(`/mailings/${mailingId}/restore-excluded`, 'POST', null, { emails });
}

export function sendTestEmail (mailingId: number, email: string): Promise<void> {
  return apiRequest(`/mailings/${mailingId}/send-test-email`, 'POST', null, {
    email
  });
}

export async function updateMailing (id: number, data: any): Promise<void> {
  await apiRequest('/mailings/' + id, 'PUT', null, data);
}
