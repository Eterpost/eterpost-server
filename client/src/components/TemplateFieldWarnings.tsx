import * as React from 'react';
import {
  canInsertField, checkTemplateFields, fieldPlaceholder, FieldProblem, fieldTitle,
  ReceiverFieldStats
} from '../../../server/src/templateFields';


export interface TemplateFieldWarningsProps {
  // Тема и текст письма
  sources: string[];
  stats?: ReceiverFieldStats;
}

function describe (problem: FieldProblem, total: number): string {
  const title = `«${fieldTitle(problem.field)}»`;
  switch (problem.kind) {
    case 'absent':
      return `${title}: такой колонки нет в списке получателей — в письме будет пусто.` +
        (problem.similar ? ` Может быть, «${fieldTitle(problem.similar)}»? ` +
          'Заглавные и строчные буквы различаются.' : '');
    case 'empty':
      return `${title}: пусто у всех получателей.`;
    default:
      return `${title}: пусто у ${problem.empty} из ${total}` +
        (problem.example ? `, например у ${problem.example}` : '') +
        '. Проверьте, как письмо выглядит у них.';
  }
}

/**
 * Подстановки, которые у части получателей или у всех окажутся пустыми
 */
export function TemplateFieldWarnings ({ sources, stats }: TemplateFieldWarningsProps) {
  if (!stats) {
    return null;
  }
  const problems = checkTemplateFields(sources, stats);
  if (!problems.length) {
    return null;
  }
  return (
    <ul className='field-warnings' aria-live='polite'>
      {problems.map(problem => (
        <li key={problem.field} title={fieldPlaceholder(problem.field)}>
          {describe(problem, stats.total)}
        </li>
      ))}
    </ul>
  );
}

/**
 * Поля для кнопок «Вставить поле»: имя, адрес и свои колонки получателей
 */
export function insertableFields (stats?: ReceiverFieldStats): string[] {
  const fields = ['name', 'email'];
  for (const stat of stats?.fields || []) {
    if (!fields.includes(stat.field) && canInsertField(stat.field)) {
      fields.push(stat.field);
    }
  }
  return fields;
}
