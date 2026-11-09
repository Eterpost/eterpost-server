// Шаблоны ответа сервера, по которым отказ считается отказом из-за самого
// письма или отправителя (спам, списки блокировки, репутация, SPF/DKIM/DMARC),
// а не из-за адреса: такой адрес не отбрасывается из новых рассылок, ящик
// существует. Регулярные выражения без учёта регистра; тот же набор — в
// mail-sorter (src/spamDetection.js). Переопределяются server.spamPatterns
export const DEFAULT_SPAM_PATTERNS = [
  '\\bspam',
  'unsolicited',
  'blocked using',
  '\\b(?:block|black|deny)\\s?list',
  '\\b(?:dnsbl|rbl)\\b',
  'reputation',
  '\\b(?:spf|dkim|dmarc)\\b',
  'unauthenticated|not authenticated'
];

/**
 * Возвращает функцию (ответ сервера) => отвергнуто ли письмо как спам
 */
export function createSpamDetector (patterns: string[] = DEFAULT_SPAM_PATTERNS) {
  const regexps = patterns.map(pattern => new RegExp(pattern, 'i'));
  return (response?: string) => Boolean(response) &&
    regexps.some(regexp => regexp.test(response!));
}
