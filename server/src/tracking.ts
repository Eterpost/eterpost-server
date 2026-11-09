import { randomBytes } from 'node:crypto';


export interface TrackedHtml {
  html: string;
  /**
   * Исходные адреса обёрнутых ссылок по порядку: номер в адресе перехода —
   * индекс в этом списке
   */
  links: string[];
}

/**
 * Токен письма получателю: по нему mail-server находит адрес и ссылки письма
 */
export function createTrackingToken (): string {
  return randomBytes(12).toString('base64url');
}

export function isTrackingToken (token: string): boolean {
  return /^[A-Za-z0-9_-]{1,64}$/.test(token);
}

/**
 * Готовит HTML письма к отслеживанию: ссылки http(s) ведут через
 * <baseUrl>/t/c/<рассылка>/<токен>/<номер>, в конец добавляется картинка
 * <baseUrl>/t/o/<рассылка>/<токен>. Не трогаются mailto:, якоря и ссылки,
 * начинающиеся с skipPrefixes (подписка и отписка)
 */
export function applyTracking (
  html: string, baseUrl: string, mailingId: number, token: string, skipPrefixes: string[] = []
): TrackedHtml {
  const base = baseUrl.replace(/\/+$/, '') + '/t';
  const links: string[] = [];
  const tracked = html.replace(
    /(<a\b[^>]*?\bhref\s*=\s*)(["'])(.*?)\2/gis,
    (match, prefix: string, quote: string, href: string) => {
      const url = decodeEntities(href.trim());
      if (!/^https?:\/\//i.test(url) || skipPrefixes.some(skip => skip && url.startsWith(skip))) {
        return match;
      }
      links.push(url);
      return `${prefix}${quote}${base}/c/${mailingId}/${token}/${links.length - 1}${quote}`;
    }
  );
  const pixel = `<img src="${base}/o/${mailingId}/${token}" width="1" height="1" alt="" ` +
    'style="display:block;width:1px;height:1px;border:0">';
  const bodyEnd = tracked.search(/<\/body\s*>/i);
  return {
    html: bodyEnd >= 0 ?
      tracked.slice(0, bodyEnd) + pixel + tracked.slice(bodyEnd) :
      tracked + pixel,
    links
  };
}

// Адрес из атрибута: &amp; и числовые ссылки на символы
function decodeEntities (value: string): string {
  return value
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCharCode(parseInt(code, 16)))
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&');
}
