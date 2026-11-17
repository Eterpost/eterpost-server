import type { FieldOption } from 'eterpost-letter-editor';
import {
  canInsertField, EMAIL_FIELD, fieldTitle, NAME_FIELD, ReceiverFieldStats
} from 'eterpost-letter-editor/fields';


/**
 * Кнопки «Вставить поле» в Почтаре: имя, адрес и колонки получателей под своими
 * названиями
 */
export function receiverFieldOptions (stats?: ReceiverFieldStats): FieldOption[] {
  const keys = [NAME_FIELD, EMAIL_FIELD];
  for (const stat of stats?.fields || []) {
    if (!keys.includes(stat.field) && canInsertField(stat.field)) {
      keys.push(stat.field);
    }
  }
  return keys.map(key => ({ key, title: fieldTitle(key) }));
}
