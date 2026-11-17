import queryString from 'query-string';
import { Mailing, Receiver } from './reducers/mailings';
import { MailingCreateData } from './components/AddForm';
import { MAX_RECEIVERS } from './components/ReceiverList';
import { SorterStatus } from '../../server/src/RedisSorterStatusRepository';
import type { AttachmentInfo } from '../../server/src/attachments';
import type { ReceiverFieldStats } from '../../server/src/templateFields';

export type { AttachmentInfo };


type HttpMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';

const SPACE_HEADER = 'X-Eterpost-Space';

// Пространство, в котором работает пользователь: уходит в каждом запросе к API
let currentSpace: string | undefined;

export function setCurrentSpace (space: string | undefined) {
  currentSpace = space;
}

// Ошибка ответа API: code — машинный код ошибки сервера (например, SPACE_FORBIDDEN)
// detail — текст ошибки сервера, который можно показать человеку
export class ApiError extends Error {
  constructor (
    message: string, public status: number, public code?: string, public detail?: string
  ) {
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
  return readResponse(endpoint, response);
}

async function readResponse (endpoint: string, response: Response): Promise<any> {
  // Ответ не JSON (например, 413 от nginx) — ошибка со статусом
  const jsonResponse = await response.json().catch(() => ({}));

  if (!response.ok || !jsonResponse.success) {
    const apiError = new ApiError(
      `Endpoint ${endpoint} replied with ${response.status}: ${jsonResponse.error}`,
      response.status, jsonResponse.code, jsonResponse.error
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

export function getReceiverFields (id: number): Promise<ReceiverFieldStats> {
  return apiRequest(`/mailings/${id}/receiver-fields`);
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

/**
 * receiver — адрес получателя рассылки, чьими данными заполнить письмо
 */
export function sendTestEmail (
  mailingId: number, email: string, receiver?: string
): Promise<{ receiverFound?: boolean } | undefined> {
  return apiRequest(`/mailings/${mailingId}/send-test-email`, 'POST', null, {
    email, ...(receiver ? { receiver } : {})
  });
}

export async function updateMailing (id: number, data: any): Promise<void> {
  await apiRequest('/mailings/' + id, 'PUT', null, data);
}

/**
 * Приложить файл к рассылке: тело запроса — сам файл
 */
export async function uploadAttachment (mailingId: number, file: File): Promise<AttachmentInfo> {
  const endpoint = `/mailings/${mailingId}/attachments?` +
    queryString.stringify({ filename: file.name });
  const headers: { [name: string]: string } = {
    'content-type': file.type || 'application/octet-stream'
  };
  if (currentSpace) {
    headers[SPACE_HEADER] = currentSpace;
  }
  const response = await fetch(API_URL + endpoint, {
    body: file, credentials: 'include', headers, method: 'POST'
  });
  return readResponse(endpoint, response);
}

export function deleteAttachment (mailingId: number, id: string): Promise<void> {
  return apiRequest(`/mailings/${mailingId}/attachments/${id}`, 'DELETE');
}

export function attachmentUrl (mailingId: number, id: string): string {
  return API_URL + `/mailings/${mailingId}/attachments/${id}`;
}

export interface Me {
  admin: boolean;
  key?: string;
  user?: string;
}

export function getMe (): Promise<Me> {
  return apiRequest('/me', 'GET', null, undefined, false);
}

// Администрирование: запросы без X-Eterpost-Space — админ работает со всеми пространствами

export type ApiKeyRoleType = 'admin' | 'legacy' | 'proxy' | 'space' | 'system';

export interface ApiKeyRole {
  space?: string;
  type: ApiKeyRoleType;
}

export interface AdminKey {
  createdAt: string;
  current: boolean;
  lastUsedAt?: string;
  name: string;
  role: ApiKeyRole;
}

export interface AdminSpace extends Space {
  createdAt?: string;
  mailingCount: number;
  members: string[];
}

function adminRequest (endpoint: string, method: HttpMethod = 'GET', data?: any) {
  return apiRequest('/admin' + endpoint, method, null, data, false);
}

const segment = encodeURIComponent;

export function getAllMailings (): Promise<Mailing[]> {
  return apiRequest('/mailings', 'GET', { kind: 'all' }, undefined, false);
}

export function moveMailing (id: number, space: string): Promise<void> {
  return adminRequest(`/mailings/${id}/move`, 'POST', { space });
}

export function getAdminSpaces (): Promise<AdminSpace[]> {
  return adminRequest('/spaces');
}

export function createSpace (space: { from?: string, name: string, title?: string }) {
  return adminRequest('/spaces', 'POST', space);
}

export function updateSpace (name: string, patch: { from?: string, title?: string }) {
  return adminRequest(`/spaces/${segment(name)}`, 'PUT', patch);
}

export function removeSpace (name: string) {
  return adminRequest(`/spaces/${segment(name)}`, 'DELETE');
}

export function addSpaceMember (name: string, login: string) {
  return adminRequest(`/spaces/${segment(name)}/members/${segment(login)}`, 'PUT', {});
}

export function removeSpaceMember (name: string, login: string) {
  return adminRequest(`/spaces/${segment(name)}/members/${segment(login)}`, 'DELETE');
}

export function getAdminKeys (): Promise<AdminKey[]> {
  return adminRequest('/keys');
}

export function issueKey (name: string, role: ApiKeyRole): Promise<{ key: string, name: string }> {
  return adminRequest('/keys', 'POST', { name, role });
}

export function setKeyRole (name: string, role: ApiKeyRole): Promise<void> {
  return adminRequest(`/keys/${segment(name)}/role`, 'PUT', { role });
}

export function revokeKey (name: string, force = false): Promise<void> {
  return apiRequest(`/admin/keys/${segment(name)}`, 'DELETE', force ? { force: 1 } : null,
    undefined, false);
}
