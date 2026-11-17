import queryString from 'query-string';
import { MAILING_KINDS, MailingKind } from './api';


// Выбор пользователя в адресе страницы: ссылкой на него можно поделиться
const SPACE_STORAGE_KEY = 'eterpost.space';
const DEFAULT_KIND: MailingKind = 'live';

function readQuery () {
  return queryString.parse(window.location.search);
}

function readParam (name: string): string | undefined {
  const value = readQuery()[name];
  return typeof value === 'string' && value ? value : undefined;
}

// Меняет параметры адреса, не трогая остальные; undefined — убрать параметр
function writeParams (params: { [name: string]: string | undefined }) {
  const query = { ...readQuery(), ...params };
  const search = queryString.stringify(query);
  const url = window.location.pathname + (search ? '?' + search : '') + window.location.hash;
  window.history.replaceState(window.history.state, '', url);
}

export function readSpaceFromAddress (): string | undefined {
  return readParam('space');
}

export function writeSpaceToAddress (space: string | undefined) {
  writeParams({ space });
}

export function readKindFromAddress (): MailingKind {
  const kind = readParam('kind');
  return MAILING_KINDS.includes(kind as MailingKind) ? kind as MailingKind : DEFAULT_KIND;
}

// Боевые — по умолчанию, их в адрес не пишем
export function writeKindToAddress (kind: MailingKind) {
  writeParams({ kind: kind === DEFAULT_KIND ? undefined : kind });
}

// localStorage может быть недоступен (приватный режим, запрет сайта): тогда просто не помним
export function readStoredSpace (): string | undefined {
  try {
    return localStorage.getItem(SPACE_STORAGE_KEY) || undefined;
  } catch (error) {
    return undefined;
  }
}

export function storeSpace (space: string | undefined) {
  try {
    if (space) {
      localStorage.setItem(SPACE_STORAGE_KEY, space);
    } else {
      localStorage.removeItem(SPACE_STORAGE_KEY);
    }
  } catch (error) {
    // нечего делать: выбор просто не запомнится
  }
}

// Раздел страницы: рассылки (по умолчанию) или администрирование с вкладкой
export type AdminTab = 'mailings' | 'spaces' | 'keys';

export const ADMIN_TABS: AdminTab[] = ['mailings', 'spaces', 'keys'];

export function readAdminTabFromAddress (): AdminTab | undefined {
  if (readParam('view') !== 'admin') {
    return undefined;
  }
  const tab = readParam('tab');
  return ADMIN_TABS.includes(tab as AdminTab) ? tab as AdminTab : 'mailings';
}

// undefined — обычный вид рассылок
export function writeAdminTabToAddress (tab: AdminTab | undefined) {
  writeParams({
    tab: tab && tab !== 'mailings' ? tab : undefined,
    view: tab ? 'admin' : undefined
  });
}
