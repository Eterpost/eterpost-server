# Редактор письма отдельным пакетом

Дата: 2026-11-17. Статус: согласован с lav.

## Зачем

Редактор письма Почтаря (визуальный редактор и HTML, кнопки «Вставить поле»,
предупреждения о пустых подстановках) должен встраиваться в другие интерфейсы. Первый
потребитель — sales (React 18, antd, vite): сейчас там свой редактор и свой язык
разметки, а письмо всё равно уходит в Почтарь шаблоном Handlebars с данными
получателей в `extraData`.

Условия рассылки редактору знать не нужно: тот, кто встраивает, вычисляет их заранее
для каждого получателя и кладёт готовым значением в `extraData` (sales так и делает:
ключи `if_own_<номер>`). Редактору достаточно списка полей с понятными названиями.

## Решения

- Распространение — React-компонент пакетом из отдельного репозитория по git-тегу,
  как `ipfs-images-components` (`"github:Eterpost/ipfs-images-components#v2.1.1"`).
  Веб-компонент и iframe отклонены: у обоих потребителей React 18, а связь через
  атрибуты, события или `postMessage` неудобнее props.
- Первая версия — только выделение того, что есть; поведение для пользователя
  Почтаря не меняется. Развилки («если поле заполнено / равно X») — следующий шаг,
  уже в пакете.
- Предпросмотр, пробное письмо и ключ API в пакет не входят: это дело хозяина.

## Репозиторий и сборка

- Репозиторий `Eterpost/eterpost-letter-editor` на GitHub и в GitLab
  (`etersoft/eterpost-letter-editor`), публикация `gpush`. Лицензия AGPL-3.0, как у
  eterpost-server.
- Имя пакета `eterpost-letter-editor`, подключение
  `"eterpost-letter-editor": "github:Eterpost/eterpost-letter-editor#vX.Y.Z"`.
- TypeScript в strict-режиме, ESM. `react` и `react-dom` ^18 — peer-зависимости;
  зависимости — `pell`, `react-tabs`, `pretty`; бинарных модулей нет.
- Сборка: `tsc` в `dist/` (`.js` и `.d.ts`), стили — sass в один
  `dist/letter-editor.css`, туда же стили `pell` и `react-tabs`. Собранный `dist/`
  входит в коммит релиза (тега): у потребителя установка не собирает пакет и не
  требует sass и tsc. Между релизами `dist/` может отставать от исходников; перед
  тегом — `npm run build`, проверка, что `dist/` свежий, — в тестах.
- `package.json`, поле `exports`:
  - `.` — `dist/index.js` (компонент и типы);
  - `./fields` — `dist/fields.js` (без React, годится для сервера). Сервер Почтаря
    собирается в CommonJS и подключает его через `require()` ESM-модуля: так умеет
    Node 22.12+ (на проде 22.23), а TypeScript при `module: nodenext` это
    разрешает — двойная сборка не нужна;
  - `./style.css` — `dist/letter-editor.css`.

## Интерфейс

```tsx
import { LetterEditor } from 'eterpost-letter-editor';
import 'eterpost-letter-editor/style.css';

<LetterEditor
  html={html}
  onChange={setHtml}
  fields={[{ key: 'name', title: 'Имя' }, { key: 'extraData.if_own_3', title: 'Крупный клиент' }]}
  stats={stats}
  subject={subject}
  uploadImage={async file => url}
  extraTabs={[{ name: 'Получатели', content: <Receivers /> }]}
  fieldsHint='свои колонки появятся здесь, когда загрузите получателей'
/>
```

| Prop | Обязателен | Смысл |
|------|-----------|-------|
| `html` | да | Текст письма (Handlebars) |
| `onChange` | нет | Новый текст; без него редактор только показывает |
| `fields` | нет | Кнопки «Вставить поле»: `key` — поле (`name`, `email`, `extraData.<колонка>`), `title` — подпись. Нет — нет строки кнопок |
| `fieldsHint` | нет | Подсказка после кнопок |
| `stats` | нет | Сводка по получателям (`ReceiverFieldStats`) — по ней предупреждения под редактором. Нет — нет предупреждений |
| `subject` | нет | Тема: её поля тоже проверяются |
| `uploadImage` | нет | Загрузить картинку, вернуть её адрес; отказ — `Error` с текстом для пользователя. Нет — нет кнопки картинки |
| `extraTabs` | нет | Свои вкладки после «Редактор» и «HTML» |
| `className` | нет | Дополнительный класс корня |

Предупреждения показывают `title` поля из `fields`, если оно там есть, иначе
название колонки.

Вход `eterpost-letter-editor/fields` — нынешний `server/src/templateFields.ts` без
изменений поведения: `fieldPlaceholder`, `fieldTitle`, `canInsertField`,
`findTemplateFields`, `checkTemplateFields`, `collectFieldStats`,
`FieldStatsCollector` и типы. Сервер Почтаря берёт `FieldStatsCollector` оттуда для
`GET /mailings/:id/receiver-fields`.

## Стили

- Корень — `.le-editor`, все классы с префиксом `le-`; правила для `pell` и
  `react-tabs` — только внутри `.le-editor` (сейчас часть висит на `:root`).
- Цвета — переменные `--le-bg`, `--le-surface`, `--le-text`, `--le-muted`,
  `--le-border`, `--le-accent`, `--le-selected`, `--le-hover`, `--le-pressed`,
  `--le-warning`, `--le-focus` со значениями по умолчанию для светлой темы и для
  `prefers-color-scheme: dark`. Хозяин переопределяет их на `.le-editor` или выше.
- Кнопка «Светлый фон» (письмо на белом в тёмной теме) остаётся; выбор запоминается
  в `localStorage` под ключом `le-light-preview`, недоступное хранилище не ломает
  редактор.

## Почтарь после выделения

- Удаляются `client/src/components/Editor.tsx`, `RichTextEditor.tsx`,
  `TemplateFieldWarnings.tsx`, `server/src/templateFields.ts`, стили редактора из
  `client/src/styles/Editor.scss`; тесты `templateFields.test.ts` переезжают в пакет.
- `AddForm` и `MailingDetailView` используют `<LetterEditor>`. Список полей: Имя,
  Адрес и колонки получателей (подпись — название колонки).
- `uploadImage` — в клиенте Почтаря: загрузка в ipfs-images, `imageUrl`,
  `imageUploadError`, ширина картинки 500 px остаётся за редактором.
- Переменные `--le-*` привязываются к токенам Почтаря в его стилях.
- `package.json`: зависимость по тегу; `pell`, `react-tabs`, `pretty` уходят из
  зависимостей Почтаря, если больше нигде не нужны. Сервер (прод) ставит пакет как
  обычную зависимость: `fields` нужен ему в работе.
- Разработка пакета вместе с Почтарём — через `file:../eterpost-letter-editor`, в
  коммит — только ссылка на тег.

## Проверка

- Пакет: `node:test` для `fields` (перенесённые тесты) и отрисовка `LetterEditor`
  через `react-dom/server` (кнопки полей, предупреждения, без `uploadImage` нет кнопки
  картинки); `lint`, `typecheck`, проверка свежести `dist/`.
- Почтарь: все тесты с `TEST_REDIS_URL`, сквозные тесты стенда, в браузере на
  стенде — вставка поля в визуальный редактор и в HTML, картинка, предупреждения,
  тёмная тема и «Светлый фон», вкладки «Получатели» и «Ошибки доставки».

## Версии и выпуск

- Пакет — с 0.1.0, CHANGELOG, теги `vX.Y.Z`, релиз на GitHub.
- eterpost-server — 0.6.0: поля и предупреждения (коммит `2f453d7`) и переход на
  пакет. Деплой на прод, новость на eterpost.ru.
- README пакета — пример встраивания для sales. Само подключение в sales делает
  его автор: репозиторий не наш.

## Вне этой работы

- Развилки по полю и счёт получателей по веткам.
- Списки в получателе (массивы в `extraData`, `{{#each}}`): CSV их не передаёт,
  JSON через API — передаёт.
- Вставка полей в тему письма (поле темы — у хозяина).
