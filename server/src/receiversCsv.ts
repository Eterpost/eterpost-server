/**
 * Разбор таблицы получателей (строки CSV-файла после парсера). Модуль без
 * зависимостей: им пользуется веб-клиент при загрузке файла
 *
 * Форматы:
 * - с заголовком: первая строка — названия колонок, нужна колонка email,
 *   name (или «имя») — имя, остальные колонки попадают в extraData под своими
 *   названиями;
 * - старый, без заголовка: email, имя, extraData в JSON. Если JSON с запятыми
 *   не взят в кавычки, парсер CSV режет его на колонки — они склеиваются обратно
 */

export interface ParsedReceiver {
  email: string;
  extraData: { [field: string]: string | unknown };
  name: string;
}

export interface ParsedReceivers {
  errors: string[];
  // true — файл с заголовком
  header: boolean;
  receivers: ParsedReceiver[];
}

const EMAIL_COLUMNS = ['email', 'e-mail', 'адрес'];
const NAME_COLUMNS = ['name', 'имя'];
// Не больше стольких ошибок в списке: дальше — «и ещё N»
const MAX_ERRORS = 10;

function clean (cell: unknown): string {
  return String(cell ?? '').replace(/^\uFEFF/, '').trim();
}

function isEmpty (row: string[]): boolean {
  return row.every(cell => !cell);
}

function isHeader (row: string[]): boolean {
  return row.some(cell => EMAIL_COLUMNS.includes(cell.toLowerCase()));
}

export function parseReceiverRows (rows: unknown[][]): ParsedReceivers {
  const cleaned = rows.map(row => row.map(clean));
  const first = cleaned.findIndex(row => !isEmpty(row));
  if (first < 0) {
    return { errors: [], header: false, receivers: [] };
  }
  const result = isHeader(cleaned[first]) ?
    parseWithHeader(cleaned, first) : parseLegacy(cleaned, first);
  if (result.errors.length > MAX_ERRORS) {
    const more = result.errors.length - MAX_ERRORS;
    result.errors = [...result.errors.slice(0, MAX_ERRORS), `…и ещё ошибок: ${more}`];
  }
  return result;
}

function parseWithHeader (rows: string[][], headerIndex: number): ParsedReceivers {
  const header = rows[headerIndex];
  const errors: string[] = [];
  const lower = header.map(cell => cell.toLowerCase());
  const emailColumn = lower.findIndex(cell => EMAIL_COLUMNS.includes(cell));
  const nameColumn = lower.findIndex(cell => NAME_COLUMNS.includes(cell));
  const seen = new Set<string>();
  header.forEach((cell, index) => {
    if (cell && seen.has(cell)) {
      errors.push(`строка ${headerIndex + 1}: колонка «${cell}» повторяется`);
    }
    seen.add(cell);
    if (!cell && rows.some((row, rowIndex) => rowIndex > headerIndex && row[index])) {
      errors.push(`строка ${headerIndex + 1}: у колонки ${index + 1} нет названия`);
    }
  });
  const receivers: ParsedReceiver[] = [];
  for (let index = headerIndex + 1; index < rows.length; index++) {
    const row = rows[index];
    if (isEmpty(row)) {
      continue;
    }
    if (row.length > header.length && row.slice(header.length).some(Boolean)) {
      errors.push(`строка ${index + 1}: значений больше, чем колонок в заголовке`);
      continue;
    }
    const email = row[emailColumn] || '';
    if (!email) {
      errors.push(`строка ${index + 1}: нет адреса`);
      continue;
    }
    const extraData: { [field: string]: string } = {};
    header.forEach((field, column) => {
      if (field && column !== emailColumn && column !== nameColumn) {
        extraData[field] = row[column] ?? '';
      }
    });
    receivers.push({ email, extraData, name: nameColumn >= 0 ? row[nameColumn] || '' : '' });
  }
  return { errors, header: true, receivers };
}

function parseLegacy (rows: string[][], firstIndex: number): ParsedReceivers {
  const errors: string[] = [];
  const receivers: ParsedReceiver[] = [];
  for (let index = firstIndex; index < rows.length; index++) {
    const row = rows[index];
    if (isEmpty(row)) {
      continue;
    }
    const [email, name = ''] = row;
    if (!email) {
      errors.push(`строка ${index + 1}: нет адреса`);
      continue;
    }
    const json = row.slice(2).filter((cell, cellIndex) => cell || cellIndex === 0).join(',');
    let extraData = {};
    if (json) {
      try {
        extraData = JSON.parse(json);
      } catch (error) {
        errors.push(`строка ${index + 1}: третья колонка — не JSON (${json.slice(0, 40)})`);
        continue;
      }
      if (!extraData || typeof extraData !== 'object' || Array.isArray(extraData)) {
        errors.push(`строка ${index + 1}: в третьей колонке нужен JSON-объект {…}`);
        continue;
      }
    }
    receivers.push({ email, extraData, name });
  }
  return { errors, header: false, receivers };
}

/**
 * Текст файла: UTF-8 (с BOM или без), иначе windows-1251 — так сохраняет CSV
 * русский Excel
 */
export function decodeReceiversFile (bytes: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch (error) {
    return new TextDecoder('windows-1251').decode(bytes);
  }
}
