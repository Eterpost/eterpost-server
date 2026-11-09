import { MailingRepository } from './MailingRepository';


/**
 * Одноразовая миграция: рассылкам, созданным до появления пространств, дописывает
 * пространство 'default'. Безопасна при каждом запуске: второй раз ничего не меняет.
 * Возвращает число перенесённых рассылок
 */
export async function migrateMailingsToDefaultSpace (
  repository: MailingRepository
): Promise<number> {
  return repository.setDefaultSpace();
}
