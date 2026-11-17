# Редактор письма отдельным пакетом — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** редактор письма Почтаря становится пакетом `eterpost-letter-editor`, который подключается по git-тегу в Почтарь и в sales; Почтарь выходит как 0.6.0 на этом пакете; затем сервер Почтаря переходит на ESM.

**Architecture:** новый репозиторий с React-компонентом `LetterEditor` и входом без React `fields` (бывший `server/src/templateFields.ts`); собранный `dist/` лежит в теге. Почтарь берёт из пакета компонент (клиент) и `FieldStatsCollector` (сервер, CommonJS через `require()` ESM). Загрузка картинок, предпросмотр и ключ API остаются в Почтаре.

**Tech Stack:** TypeScript 6 (strict, ESM), React 18 (peer), pell, react-tabs, pretty, sass, `node:test`, `react-dom/server`; Почтарь — Express 5, webpack 5, Node 22.23.

**Spec:** `docs/specs/2026-11-17-letter-editor-package-design.md`

Каталоги: пакет — `/srv/lav/Projects/Claude/node-dev/eterpost-letter-editor` (P), Почтарь — `/srv/lav/Projects/Claude/node-dev/mail-server` (M). В M работа в ветке `letter-editor-package` от `master` (там уже `d715005` — поля и предупреждения).

## Global Constraints

- Коммиты по-английски, **без** трейлера `Co-Authored-By`; файлы добавлять явными путями; публикация — `gpush`, не `git push`; пушить и выкладывать на прод — только по слову lav.
- P: имя `eterpost-letter-editor`, версия 0.1.0, лицензия AGPL-3.0, `"type": "module"`, `engines.node` `>=22.12.0`; peer `react`, `react-dom` `^18`; зависимости `pell`, `react-tabs`, `pretty`; без бинарных модулей.
- P `exports`: `.` → `dist/index.js`, `./fields` → `dist/fields.js`, `./style.css` → `dist/letter-editor.css` (у JS — условие `types` на `.d.ts`).
- Подключение: `"eterpost-letter-editor": "github:Eterpost/eterpost-letter-editor#v0.1.0"`; на время разработки в M — `file:../eterpost-letter-editor`, в коммит релиза — только тег.
- Классы пакета — с префиксом `le-`, корень `.le-editor`; цвета — переменные `--le-bg`, `--le-surface`, `--le-text`, `--le-muted`, `--le-border`, `--le-accent`, `--le-selected`, `--le-hover`, `--le-pressed`, `--le-warning`, `--le-focus`; ключ `localStorage` — `le-light-preview`.
- Поведение `fields` не меняется: тексты и сигнатуры — как в `server/src/templateFields.ts` коммита `d715005`.
- Тексты интерфейса редактора — прежние: «Редактор», «HTML», «Светлый фон», «Вставить поле:», «Вставить {{…}}», предупреждения из `TemplateFieldWarnings.tsx`.
- Тесты M — всегда с `TEST_REDIS_URL=redis://127.0.0.1:16379/1`, иначе тесты Redis молча пропускаются.

## Review Focus

1. Стили пакета в чужом интерфейсе (antd): ни одного правила вне `.le-editor`, кроме `@media`/`@keyframes` с вложенными правилами под `.le-editor`. Тест: Task 2, `css is scoped`.
2. Набор текста после вставки поля: курсор не прыгает, поле встаёт на место курсора, повторная вставка — следом. Проверка в браузере: Task 5.
3. Хозяин без `uploadImage` или без `localStorage` (песочница, приватный режим): редактор рисуется, кнопки картинки нет. Тест: Task 2, `renders without optional props`.
4. Колонка с «]» в названии не предлагается кнопкой, колонка с пробелами вставляется в скобках. Тесты переезжают в Task 1.
5. Сервер на CommonJS загружает ESM-пакет на Node 22.23 (`require()` ESM). Тест: Task 4, `receiverFields.test.ts` проходит на собранном сервере.

---

## Часть 1. Пакет

### Task 1: Репозиторий и вход `fields`

**Files:**
- Create (P): `package.json`, `tsconfig.json`, `eslint.config.js`, `.gitignore` (`node_modules/`), `LICENSE` (копия из M), `src/fields.ts`, `test/fields.test.mjs`
- Modify: `/srv/lav/Projects/Claude/node-dev/.gitignore` — строка `/eterpost-letter-editor/` в «Nested upstream clones»

**Interfaces:**
- Produces: `eterpost-letter-editor/fields` — ровно экспорт нынешнего `server/src/templateFields.ts`: `NAME_FIELD`, `EMAIL_FIELD`, `FieldStat`, `ReceiverFieldStats`, `FieldReceiver`, `FieldProblemKind`, `FieldProblem`, `FieldStatsCollector`, `collectFieldStats`, `canInsertField`, `fieldPlaceholder`, `fieldTitle`, `findTemplateFields`, `checkTemplateFields`.

- [ ] **Step 1: `git init` в P, `package.json` по Global Constraints.** Скрипты: `build` = `tsc -p . && sass --no-source-map --load-path=node_modules src/letter-editor.scss dist/letter-editor.css` (scss появится в Task 2; до него `build:js` = `tsc -p .`), `test` = `npm run build && node --test test/`, `lint` = `eslint .`, `typecheck` = `tsc -p . --noEmit`, `verify` = `npm run build && git diff --exit-code -- dist`. `tsconfig`: `module`/`moduleResolution` `nodenext`, `target` `es2022`, `strict`, `jsx` `react-jsx`, `declaration`, `rootDir` `src`, `outDir` `dist`, `lib` `["es2022", "dom"]`. ESLint — как в M (`eslint.config.mjs`), с `max-len` 100.
- [ ] **Step 2: Тест.** `test/fields.test.mjs` — четыре случая из `server/tests/templateFields.test.ts` (`counts filled fields in one pass`, `finds receiver fields inside mustaches only`, `makes placeholders that Handlebars fills`, `warns about empty and unknown fields`) на JS, импорт из `../dist/fields.js`; `handlebars` — devDependency. Случай контроллера сюда не переносится (он остаётся в M, Task 4).
- [ ] **Step 3: Запустить `npm test`** — FAIL: нет `dist/fields.js`.
- [ ] **Step 4: `src/fields.ts`** — содержимое `M/server/src/templateFields.ts` из `d715005` без изменений, кроме шапки комментария (модуль пакета редактора, им пользуются клиент и сервер Почтаря).
- [ ] **Step 5: `npm test`, `npm run lint`** — PASS, 4 теста.
- [ ] **Step 6: Commit** `Add the receiver fields module` (вместе с `dist/`).

### Task 2: Компонент `LetterEditor` и стили

**Files:**
- Create (P): `src/index.ts`, `src/LetterEditor.tsx`, `src/RichText.tsx`, `src/FieldWarnings.tsx`, `src/storage.ts`, `src/modules.d.ts`, `src/letter-editor.scss`, `test/LetterEditor.test.mjs`, `test/css.test.mjs`

**Interfaces:**
- Consumes: Task 1 `fields`.
- Produces:
  ```ts
  export interface FieldOption { key: string; title: string }
  export interface EditorTab { name: string; content: React.ReactNode }
  export interface LetterEditorProps {
    html: string; onChange?: (html: string) => void;
    fields?: ReadonlyArray<FieldOption>; fieldsHint?: string;
    stats?: ReceiverFieldStats; subject?: string;
    uploadImage?: (file: File) => Promise<string>;
    extraTabs?: ReadonlyArray<EditorTab>; className?: string;
  }
  export class LetterEditor extends React.Component<LetterEditorProps> {}
  export * from './fields.js';
  ```

- [ ] **Step 1: Тесты.** `test/LetterEditor.test.mjs` (`React.createElement`, `renderToStaticMarkup` из `react-dom/server`):
  - `renders field buttons with host titles`: `fields=[{key:'name',title:'Имя'},{key:'extraData.if_own_3',title:'Крупный клиент'}]` → в разметке `class="le-editor`, «Вставить поле:», `>Крупный клиент<`, `title="Вставить {{receiver.extraData.if_own_3}}"`;
  - `warns with host titles`: `html='{{receiver.extraData.if_own_3}}'`, `stats` из `collectFieldStats([{email:'a@x.ru',extraData:{if_own_3:''}}])`, те же `fields` → текст `«Крупный клиент»: пусто у всех получателей.`;
  - `renders without optional props`: только `html` → нет `le-fields`, нет `le-warnings`, нет кнопки с `name`/`title` картинки; при `globalThis.localStorage` с геттером, бросающим ошибку, отрисовка не падает;
  - `adds the image button only with uploadImage`: с `uploadImage` в разметке есть кнопка «Вставить изображение».

  `test/css.test.mjs` — `css is scoped`: каждый селектор в `dist/letter-editor.css` вне `@media`/`@supports` начинается с `.le-editor`; внутри `@media` — тоже; правил `:root`, `body`, `html`, голых `.pell`/`.react-tabs` нет. Разбор — регуляркой по `{`/`}` с учётом вложенности, без зависимостей.
- [ ] **Step 2: `npm test`** — FAIL: нет `dist/index.js`.
- [ ] **Step 3: Перенос кода.**
  - `RichText.tsx` — `M/client/src/components/RichTextEditor.tsx` из `d715005`: сохранение места курсора, `insertText`, защита `componentDidUpdate`, вставка в пустой текст абзацем. Загрузка картинки — через проп `uploadImage(file): Promise<string>` вместо `IMAGE_SERVICE_URL`; отказ — `alert(error.message)`; ширина вставленной картинки 500. Действие `image` в `pell` — только если `uploadImage` передан. Монтирование pell — только в браузере (`componentDidMount`), чтобы `renderToStaticMarkup` работал.
  - `LetterEditor.tsx` — `M/client/src/components/Editor.tsx`: вкладки «Редактор», «HTML», затем `extraTabs`; строка `le-fields` — кнопки по `fields` (подпись `title`, вставка `fieldPlaceholder(key)`), `fieldsHint`; под вкладками — `FieldWarnings` при `stats`; «Светлый фон» через `storage.ts` (`readFlag`/`writeFlag` с try/catch, ключ `le-light-preview`).
  - `FieldWarnings.tsx` — `M/client/src/components/TemplateFieldWarnings.tsx`; подпись поля — `title` из `fields`, иначе `fieldTitle`.
  - `modules.d.ts` — объявления `pell` (как в `M/client/src/globals.d.ts`) и `pretty`.
  - Классы M → пакета: `editor-*` → `le-*`, `field-warnings` → `le-warnings`, `editor-wrapper` → `le-panel`, `light-preview` → `le-light`.
- [ ] **Step 4: `src/letter-editor.scss`.** Всё под `.le-editor`: `@use` стилей `pell/dist/pell.css` и `react-tabs/style/react-tabs.scss` через `meta.load-css` внутри `.le-editor`; правила из `M/client/src/styles/Editor.scss` с заменой токенов на `var(--le-*)`; значения переменных по умолчанию на `.le-editor` и в `@media (prefers-color-scheme: dark) { .le-editor {…} }` — взять из `theme-colors` в `M/client/src/styles/_tokens.scss`; кольцо фокуса — `outline: 2px solid var(--le-focus)`.
- [ ] **Step 5: `npm test`, `npm run lint`, `npm run typecheck`** — PASS, 9 тестов.
- [ ] **Step 6: Commit** `Add the letter editor component` (вместе с `dist/`).

### Task 3: Документация и выпуск 0.1.0

**Files:**
- Create (P): `README.md`, `CHANGELOG.md`

- [ ] **Step 1: `README.md`** — назначение, установка по тегу, пример из спецификации (раздел «Интерфейс») и таблица props, переменные `--le-*`, вход `fields`, совет для sales: условия вычислять заранее и класть в `extraData` флагами, подпись поля — через `title`. `CHANGELOG.md` — `## 0.1.0 — <дата>`.
- [ ] **Step 2: `npm run verify`** — `dist/` свежий (пустой `git diff`).
- [ ] **Step 3: Commit** `Release 0.1.0`, аннотированный тег `v0.1.0`.
- [ ] **Step 4 (по слову lav): публикация.** GitHub-репозиторий `Eterpost/eterpost-letter-editor` и проект GitLab `etersoft/eterpost-letter-editor` (lavtomate, подтверждение в интерфейсе Lavtomate), remotes `pub.github`/`pub.gitlab` как в `ipfs-images-components`, `gpush` с тегом, релиз v0.1.0 на GitHub.

## Часть 2. Почтарь 0.6.0

### Task 4: Сервер берёт `fields` из пакета

**Files:**
- Modify (M): `package.json`, `package-lock.json` (зависимость `file:../eterpost-letter-editor`), `server/src/controllers/getReceiverFields.ts`
- Delete: `server/src/templateFields.ts`
- Rename+modify: `server/tests/templateFields.test.ts` → `server/tests/receiverFields.test.ts` (только случай `serves the summary over all saved receivers`, `collectFieldStats` — из пакета)

**Interfaces:**
- Consumes: `FieldStatsCollector`, `collectFieldStats` из `eterpost-letter-editor/fields`.

- [ ] **Step 1:** ветка `letter-editor-package`; `npm install ../eterpost-letter-editor`; переименовать и сократить тест, импорт из пакета.
- [ ] **Step 2: `npx tsc -p server`** — FAIL: импорт `../src/templateFields` в контроллере (после удаления файла).
- [ ] **Step 3:** контроллер импортирует `FieldStatsCollector` из `eterpost-letter-editor/fields`; удалить `server/src/templateFields.ts`.
- [ ] **Step 4: Все тесты M** — PASS (`receiverFields.test.ts` выполняется на собранном CommonJS-сервере и грузит ESM-пакет).
- [ ] **Step 5: Commit** `Take receiver fields from the letter editor package`.

### Task 5: Клиент на `LetterEditor`

**Files:**
- Create (M): `client/src/uploadImage.ts`, `client/src/receiverFieldOptions.ts`, `client/src/styles/LetterEditor.scss`
- Modify: `client/src/components/AddForm.tsx`, `client/src/components/MailingDetailView.tsx`, `client/src/api.ts` (тип `ReceiverFieldStats` из пакета), `client/src/globals.d.ts` (убрать `pell`, `pretty`), `client/src/styles/Editor.scss` → оставить только раскладку формы и общие правила `react-tabs` (их использует `EmailPreviewView`), `package.json` (убрать `pell`, `pretty`; `react-tabs` остаётся)
- Delete: `client/src/components/Editor.tsx`, `client/src/components/RichTextEditor.tsx`, `client/src/components/TemplateFieldWarnings.tsx`

**Interfaces:**
- Consumes: Task 2 `LetterEditor`, `FieldOption`, `fields`.
- Produces: `uploadImage(file: File): Promise<string>` в `client/src/uploadImage.ts` (тело — `uploadFile` из `RichTextEditor.tsx`, `imageUrl`, `imageUploadError`; ошибка — `Error` с текстом `imageUploadError(status)`); `receiverFieldOptions(stats?: ReceiverFieldStats): FieldOption[]` в `client/src/receiverFieldOptions.ts` (Имя, Адрес, затем колонки с `canInsertField`, `title` = название колонки).

- [ ] **Step 1:** заменить `Editor` и `TemplateFieldWarnings` в `AddForm` и `MailingDetailView` на `<LetterEditor html onChange fields={receiverFieldOptions(stats)} stats subject uploadImage extraTabs>` (у `AddForm` — `fieldsHint` прежний, у карточки — `extraTabs` = прежние `listTabs`); удалить старые компоненты; стили пакета — `import 'eterpost-letter-editor/style.css'` в `AddForm` и `MailingDetailView` (webpack уже обрабатывает CSS; проверить, что правило лоадера ловит `.css`, иначе добавить); `LetterEditor.scss` — привязка `--le-*` к токенам Почтаря на `.le-editor` и раскладка `.form-group.stretch`, перенесённая с `.react-tabs`/`.editor-wrapper` на `.le-editor`/`.le-panel`.
- [ ] **Step 2: `npm run typecheck`, `npm run lint`, все тесты, `npm run client:build`** — PASS.
- [ ] **Step 3: Стенд** `stand/run.sh --keep` — e2e PASS; в браузере (http://127.0.0.1:18100/) на рассылке с колонками и пустыми значениями: вставка поля в визуальный редактор на место курсора, набор после неё, повторная вставка; вставка во вкладке HTML; загрузка картинки; предупреждения (`City` при колонке `city`, «пусто у 1 из 3»); тёмная тема и «Светлый фон»; вкладки «Получатели», «Ошибки доставки»; форма новой рассылки с загрузкой CSV; вкладки предпросмотра выглядят как раньше; в консоли нет ошибок.
- [ ] **Step 4: Commit** `Use the letter editor package in the web client`.

### Task 6: Выпуск 0.6.0

**Files:**
- Modify (M): `package.json`, `package-lock.json` (зависимость → `github:Eterpost/eterpost-letter-editor#v0.1.0`), `Dockerfile` (`apk add --no-cache git` в стадиях `build` и `server`: `npm ci` ставит пакет из git), `CHANGELOG.md` (`Unreleased` → `0.6.0 — <дата>`, пункт про пакет редактора), `README.md`, `README.ru.md` (раздел о редакторе: пакет и ссылка на него)

- [ ] **Step 1:** зависимость по тегу, `npm install`; `stand/run.sh` (Docker-сборка с git-зависимостью) — PASS; все тесты — PASS.
- [ ] **Step 2: Commit** `Release 0.6.0` (`npm version 0.6.0 --no-git-tag-version`), аннотированный тег `v0.6.0`, merge ветки в `master`.
- [ ] **Step 3 (по слову lav):** `gpush` с тегом, релиз v0.6.0 на GitHub, деплой `update.sh` (вывод через `tee` в `~/tmp/claude`), проверка на проде: `/api/mailings/<id>/receiver-fields` отвечает, интерфейс с кнопками полей; новость на eterpost.ru (версии в новостях), `gpush` и `rsync` сайта.

## Часть 3. Сервер Почтаря на ESM (после 0.6.0)

### Task 7: `"type": "module"`

**Files:**
- Modify (M): `package.json` (`"type": "module"`, скрипты с `client/webpack.config.cjs`), `client/webpack.config.js` → `client/webpack.config.cjs` (+ `resolve.extensionAlias: { '.js': ['.ts', '.tsx', '.js'] }`), все `server/src/**/*.ts`, `server/tests/**/*.ts` (относительные импорты с `.js`), `server/src/openapi.ts`, `server/src/readConfig.ts`, `server/src/templates/readTemplate.ts`, `server/tests/subscription.test.ts`, `server/tests/openapi.test.ts` (`__dirname` → `import.meta.dirname`), `server/src/attachments.ts` (`require` → `createRequire(import.meta.url)`), `stand/` и `deploy/lxc/update.sh` — если ссылаются на `webpack.config.js`, `CHANGELOG.md`

- [ ] **Step 1:** `"type": "module"` и `npx tsc -p server` — FAIL: импорты без расширений (около 520 в 98 файлах).
- [ ] **Step 2:** дописать `.js` скриптом (`from '(\.\.?/[^']+)'` → с `.js`, кроме уже имеющих расширение; каталог с `index.ts` → `/index.js`); `__dirname` и `require` — вручную по списку выше.
- [ ] **Step 3:** `npm run typecheck`, `npm run lint`, все тесты, `npm run build`, `node server/dist/src/index.js` стартует с `config.default.json` — PASS; стенд `run.sh` — PASS; импорты клиента из `server/src` собираются webpack.
- [ ] **Step 4: Commit** `Switch the server to ES modules`; CHANGELOG `0.6.1` (внутреннее изменение, поведение то же), тег `v0.6.1`; публикация и деплой — по слову lav.
