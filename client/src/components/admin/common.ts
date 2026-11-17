import { ApiError, Space } from '../../api';


/**
 * Сообщения админки: успех и ошибка через общие уведомления
 */
export interface AdminNotify {
  onError: (text: string) => void;
  onSuccess: (text: string) => void;
}

/**
 * Текст ошибки для человека: что не удалось и, если сервер объяснил, почему
 */
export function describeError (error: unknown, what: string): string {
  if (error instanceof ApiError && error.detail) {
    return `${what}: ${error.detail}`;
  }
  return what + '.';
}

export function spaceTitle (spaces: Space[], name?: string): string {
  const space = spaces.find(item => item.name === (name || 'default'));
  return space?.title || name || 'default';
}

export function formatDateTime (iso?: string): string {
  if (!iso) {
    return '—';
  }
  const date = new Date(iso);
  return isNaN(date.getTime()) ? '—' : date.toLocaleString('ru-RU', {
    day: '2-digit', hour: '2-digit', minute: '2-digit', month: '2-digit', year: 'numeric'
  });
}
