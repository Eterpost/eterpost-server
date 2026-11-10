# Вложения в рассылках — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** файлы (PDF-прайсы) прикладываются к рассылке и уходят каждому получателю настоящими вложениями письма.

**Architecture:** файлы — на диске в `server.attachments.dir/<mailingId>/<id>` (`AttachmentStore`), описания — поле `attachments` в JSON рассылки. Маршруты `/mailings/:id/attachments` загружают, отдают и удаляют файлы; `MailingExecutor` передаёт nodemailer `{ filename, contentType, path }`.

**Tech Stack:** TypeScript, Express 5, Redis, nodemailer, React (клиент), `node:test`.

**Spec:** `docs/specs/2026-11-10-mailing-attachments-design.md` (задача 20027)

## Global Constraints

- Новых npm-зависимостей нет: `node:fs/promises`, `node:crypto`, `express.raw`, `detectMimeType` из `nodemailer/lib/mime-funcs/mime-types`.
- `server.attachments.maxSize` по умолчанию `10485760`; `server.attachments.dir` по умолчанию `data/attachments`, в deploy-конфиге `/var/lib/eterfund-mail/attachments`.
- id вложения — `crypto.randomBytes(8).toString('hex')` (16 hex); имя пользователя в путь не попадает.
- Имя файла: basename, без управляющих символов, ≤ 200 символов; пустое — 400.
- Коды ошибок: 400 (нет имени), 404 (нет рассылки/вложения), 409 (рассылка RUNNING), 413 (превышен общий размер), 503 (каталог недоступен).
- mail-sorter не меняется.
- Комментарии в коде — по-русски, как в окружающем коде; коммиты — по-английски, с трейлером `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Проверка перед завершением каждой задачи: `npm run typecheck && npm run lint && npm test`.

## Review Focus

1. Имя файла с кириллицей и пробелами (`Прайс ноябрь.pdf`) — скачивание отдаёт его в `Content-Disposition` корректно (RFC 5987, `res.attachment()`), в письме nodemailer кодирует сам. Тест: Task 4.
2. Имя вида `../../etc/passwd` или `C:\x\прайс.pdf` — сохраняется как `passwd` / `прайс.pdf`, файл всё равно ложится под случайным id. Тест: Task 1.
3. Загрузка, которая вместе с уже приложенными превышает лимит, хотя сама меньше лимита — 413, файл не остаётся на диске. Тест: Task 4.
4. Файл вложения пропал с диска — рассылка и пробное письмо не уходят без вложения, а получают ошибку с именем файла. Тест: Task 6.
5. Две загрузки в одну рассылку одновременно — обе описания сохраняются (через `updateInTransaction`). Тест: Task 4.

---

### Task 1: Чистые функции вложений и конфиг

**Files:**
- Create: `server/src/attachments.ts`
- Modify: `server/src/Email.ts` (интерфейс `Attachment`), `config.default.json`, `server/src/validateConfig.ts`
- Test: `server/tests/attachments.test.ts`, `server/tests/validateConfig.test.ts`

**Interfaces:**
- Produces:
  - `interface AttachmentInfo { id: string; filename: string; contentType: string; size: number }`
  - `DEFAULT_ATTACHMENTS_MAX_SIZE = 10485760`
  - `normalizeFilename(name: unknown): string | null` — null для пустого/не строки
  - `detectContentType(filename: string, declared?: string): string`
  - `totalSize(attachments: AttachmentInfo[] | undefined): number`
  - `getAttachmentsConfig(config: any): { dir: string; maxSize: number }`
  - `Email.Attachment` → `{ filename: string; content?: string | Buffer; path?: string; contentType?: string }`

- [ ] **Step 1: Тесты** в `attachments.test.ts`:
  - `normalizeFilename('../../etc/passwd') === 'passwd'`, `normalizeFilename('C:\\x\\прайс.pdf') === 'прайс.pdf'`, `normalizeFilename('a\u0000b\n.pdf') === 'ab.pdf'`, `normalizeFilename('   ') === null`, `normalizeFilename(undefined) === null`, длина `normalizeFilename('x'.repeat(300) + '.pdf')` — 200 и имя заканчивается на `.pdf` (обрезается основа, расширение сохраняется).
  - `detectContentType('Прайс.PDF') === 'application/pdf'`, `detectContentType('a.pdf', 'application/octet-stream') === 'application/pdf'`, `detectContentType('a.bin', 'text/csv') === 'text/csv'`, `detectContentType('noext') === 'application/octet-stream'`.
  - `totalSize(undefined) === 0`, `totalSize([{…size: 3}, {…size: 4}]) === 7`.
  - `getAttachmentsConfig({ server: {} })` → `{ dir: 'data/attachments', maxSize: 10485760 }`.
  - в `validateConfig.test.ts`: `server.attachments.maxSize: 0` и `'10'` — ошибка `server.attachments.maxSize must be a positive number`.
- [ ] **Step 2:** `npm test` — новые тесты падают.
- [ ] **Step 3:** Реализовать `attachments.ts`; `detectContentType` берёт declared, если он не пустой и не `application/octet-stream`, иначе `detectMimeType` (импорт через `require`, типов у модуля нет). Добавить `"attachments": { "dir": "data/attachments", "maxSize": 10485760 }` в `server` в `config.default.json`; проверку в `validateConfig`. Расширить `Attachment` в `Email.ts`. Добавить `data/` в `.gitignore`.
- [ ] **Step 4:** `npm run typecheck && npm test` — проходят.
- [ ] **Step 5: Commit** `Add attachment helpers and config`

### Task 2: AttachmentStore

**Files:**
- Create: `server/src/AttachmentStore.ts`
- Test: `server/tests/AttachmentStore.test.ts` (временный каталог `fs.mkdtemp(os.tmpdir() + '/att-')`)

**Interfaces:**
- Consumes: `AttachmentInfo` (Task 1)
- Produces: `class AttachmentStore`:
  - `constructor(dir: string)`; `async init(): Promise<boolean>` — `mkdir -p` и проверка записи (`fs.access W_OK`); `available: boolean`
  - `async save(mailingId: number, content: Buffer): Promise<string>` — id; запись в `<id>.tmp`, затем `rename`
  - `path(mailingId: number, id: string): string` — бросает на id не из `/^[0-9a-f]{16}$/`
  - `async exists(mailingId: number, id: string): Promise<boolean>`
  - `async copy(from: number, to: number, attachments: AttachmentInfo[]): Promise<AttachmentInfo[]>` — `fs.copyFile`, новые id, остальные поля те же
  - `async remove(mailingId: number, id: string): Promise<void>` — нет файла — не ошибка
  - `async removeAll(mailingId: number): Promise<void>` — `rm -r --force`

- [ ] **Step 1: Тесты:** save → файл с тем же содержимым по `path`; `exists` true/false; copy → новые id, файлы в каталоге новой рассылки, исходные на месте; remove и removeAll (повторный вызов не бросает); `path(1, '../x')` бросает; `init()` на каталоге внутри файла (`<tmp>/file/sub`) → `false`, `available === false`.
- [ ] **Step 2:** `npm test` — падают.
- [ ] **Step 3:** Реализовать.
- [ ] **Step 4:** `npm test` — проходят.
- [ ] **Step 5: Commit** `Add on-disk attachment store`

### Task 3: Поле attachments у рассылки

**Files:**
- Modify: `server/src/Mailing.ts`, `server/src/RedisMailingRepository.ts` (`create`, `serializeEntity`), `server/src/controllers/getMailing.ts`
- Test: `server/tests/RedisMailingRepository.test.ts`

**Interfaces:**
- Consumes: `AttachmentInfo`
- Produces: `MailingProperties.attachments?: AttachmentInfo[]`, `Mailing.attachments: AttachmentInfo[]` (по умолчанию `[]`); `GET /mailings/:id` отдаёт `attachments` и `attachmentsMaxSize` (из `getAttachmentsConfig(config)`; в `getMailing` передать `config`).

- [ ] **Step 1: Тест:** `create({... attachments: [info]})` → `getById` возвращает те же `attachments`; `updateInTransaction(id, m => m.attachments.push(info2))` → оба сохранены; рассылка без поля → `attachments` равен `[]`.
- [ ] **Step 2:** `npm test` — падает.
- [ ] **Step 3:** Добавить поле в модель, `create` и `serializeEntity`; `getMailing(repository, config)` и маршрут в `routes.ts`.
- [ ] **Step 4:** `npm test` — проходит.
- [ ] **Step 5: Commit** `Store attachment descriptions with the mailing`

### Task 4: Маршруты загрузки, скачивания, удаления

**Files:**
- Create: `server/src/controllers/attachments.ts`
- Modify: `server/src/createExpressServer.ts`, `server/src/routes.ts`, `server/src/index.ts`
- Test: `server/tests/attachmentsApi.test.ts` (по образцу `spaceIsolation.test.ts`: Redis, ключи пространств sales/news, `AttachmentStore` во временном каталоге)

**Interfaces:**
- Consumes: `AttachmentStore`, `normalizeFilename`, `detectContentType`, `totalSize`, `getAttachmentsConfig`, `loadMailing`/`getLoadedMailing`
- Produces:
  - `uploadAttachment(repository, store, maxSize, logger)`, `downloadAttachment(store)`, `deleteAttachment(repository, store, logger)` — фабрики RequestHandler
  - `setupRoutes(..., admins, attachmentStore?: AttachmentStore)` — последний необязательный параметр (старые вызовы в тестах не меняются); без хранилища или при `!store.available` маршруты вложений отвечают 503 `ATTACHMENTS_UNAVAILABLE`
  - `isAttachmentUpload(path: string): boolean` в `createExpressServer.ts` — `/^\/mailings\/\d+\/attachments\/?$/`; общий JSON-парсер такие POST пропускает
  - ответ загрузки: `success(AttachmentInfo)` со статусом 201

- [ ] **Step 1: Тесты:**
  - загрузка `Прайс ноябрь.pdf` (Buffer 1000 байт, `Content-Type: application/pdf`, `?filename=` в `encodeURIComponent`) → 201, `size: 1000`; `GET /mailings/:id` содержит его в `attachments`; скачивание отдаёт те же байты, `content-type: application/pdf`, `content-disposition` содержит `filename*=UTF-8''%D0%9F`;
  - без `filename` → 400; `filename=..%2F..%2Fx.pdf` → сохранено как `x.pdf`;
  - лимит: `maxSize` в тесте 2000; загрузка 1500 → 201, вторая 1500 → 413, в каталоге рассылки один файл;
  - ключ news на рассылку sales → 404 на загрузку, скачивание, удаление;
  - рассылка в состоянии RUNNING (`updateInTransaction` state) → 409 на загрузку и удаление;
  - удаление → 200, файла нет, в `attachments` пусто; повторное удаление → 404;
  - две загрузки через `Promise.all` → в `attachments` обе;
  - `setupRoutes` без хранилища → 503.
- [ ] **Step 2:** `npm test` — падают.
- [ ] **Step 3:** Реализовать. Загрузка: `express.raw({ type: () => true, limit: maxSize })` на маршруте (ошибку `entity.too.large` превратить в 413 в формате `error()`); проверка RUNNING и лимита по `totalSize(mailing.attachments) + body.length`; `store.save`, затем `repository.updateInTransaction` с повторной проверкой RUNNING и лимита внутри транзакции; если транзакция отказала — `store.remove` и соответствующий код. Удаление: описание в транзакции, затем `store.remove`. Скачивание: `res.type(contentType)`, `res.attachment(filename)`, `res.sendFile(store.path(...))`. В `index.ts`: `const attachmentStore = new AttachmentStore(path.resolve(getAttachmentsConfig(config).dir))`, `await attachmentStore.init()` (при false — `logger.error` с каталогом), передать в `setupRoutes`.
- [ ] **Step 4:** `npm run typecheck && npm test` — проходят.
- [ ] **Step 5: Commit** `Add attachment upload, download and delete routes`

### Task 5: Вложения при создании, дублировании, повторе и удалении рассылки

**Files:**
- Modify: `server/src/controllers/addMailing.ts`, `createRetryMailing.ts`, `deleteMailing.ts`, `updateMailing.ts`, `server/src/routes.ts`
- Test: `server/tests/attachmentsApi.test.ts`

**Interfaces:**
- Consumes: `AttachmentStore.save/copy/removeAll`, `normalizeFilename`, `detectContentType`, `totalSize`
- Produces: `addMailing(config, repository, logger, filter, store?)`, `createRetryMailing(config, repository, logger, failureCounter, store?)`, `deleteMailing(repository, logger, store?)`

- [ ] **Step 1: Тесты:**
  - `POST /mailings` с `attachments: [{ filename: 'p.pdf', content: <base64> }]` → у рассылки одно вложение `application/pdf` нужного размера, скачивается то же содержимое;
  - то же с суммой больше лимита → 413, рассылка не создана; с невалидным элементом (нет `content` или имени) → 400;
  - `POST /mailings` с `sourceId` рассылки с вложением → у копии вложение с другим id, файл скачивается;
  - `POST /mailings/create-retry` → у повтора копия вложений;
  - `DELETE /mailings/:id` → каталог `<dir>/<id>` удалён;
  - `PUT /mailings/:id` с `attachments: []` → вложения на месте.
- [ ] **Step 2:** `npm test` — падают.
- [ ] **Step 3:** Реализовать. В `addMailing` рассылка создаётся с `attachments: []`, затем файлы сохраняются (`save` для base64, `copy` для `sourceId`) и описания записываются `updateInTransaction`; при ошибке сохранения рассылка удаляется (`repository.remove` + `store.removeAll`) и возвращается ошибка. Проверка лимита и формата — до создания. `updateMailing` не трогает `attachments` (проверить, что поле не копируется из тела; при необходимости явно исключить).
- [ ] **Step 4:** `npm run typecheck && npm test` — проходят.
- [ ] **Step 5: Commit** `Copy and remove attachments with mailings`

### Task 6: Вложения в письмах

**Files:**
- Modify: `server/src/MailingExecutor.ts`, `server/src/controllers/previewEmail.ts` (`formatPreview`), `server/src/controllers/sendTestEmail.ts`, `server/src/MailingStateManager.ts` (если ошибку старта нужно донести до API), `server/src/index.ts`
- Test: `server/tests/MailingExecutor.test.ts`, `server/tests/SmtpMailSender.test.ts`

**Interfaces:**
- Consumes: `AttachmentStore.path/exists`
- Produces:
  - `new MailingExecutor(mailer, repo, stats, spaces, logger, config, attachmentStore?)`
  - `class MissingAttachmentError extends Error { filename: string }`
  - `executor.checkAttachments(mailing): Promise<void>` — бросает `MissingAttachmentError`
  - `formatPreview` возвращает `attachments: Array<{ filename, contentType, size }>`

- [ ] **Step 1: Тесты:**
  - рассылка с вложением: `mailer.sendEmail` получает `Email` с `attachments: [{ filename, contentType, path: store.path(...) }]`; пробное письмо — тоже;
  - `SmtpMailSender`: собранное nodemailer письмо (транспорт `streamTransport`/`jsonTransport`, как в существующем тесте) содержит часть `Content-Disposition: attachment` с именем файла;
  - файл удалён с диска → `startExecution` не запускает рассылку (`sendEmail` не вызван, ошибка с именем файла), `sendTestEmail` бросает `MissingAttachmentError`; API пробного письма отвечает 409 с текстом `Attachment file is missing: <имя>`;
  - предпросмотр возвращает `attachments` без содержимого.
- [ ] **Step 2:** `npm test` — падают.
- [ ] **Step 3:** Реализовать: `createEmail` добавляет вложения; `startExecution` и `sendTestEmail` вызывают `checkAttachments` до отправки; в `startExecution` при ошибке — `MAILING_ERROR` с этой ошибкой (рассылка уходит в ERROR, как при других сбоях) и запись в журнал. В `index.ts` передать хранилище в executor.
- [ ] **Step 4:** `npm run typecheck && npm test` — проходят.
- [ ] **Step 5: Commit** `Send mailing attachments with every letter`

### Task 7: OpenAPI

**Files:**
- Modify: `server/src/openapi.ts`
- Test: `server/tests/openapi.test.ts` (уже сверяет маршруты с описанием)

- [ ] **Step 1:** `npm test` — `openapi.test` падает: новых маршрутов нет в описании.
- [ ] **Step 2:** Описать три маршрута (тело загрузки — `application/octet-stream`, `format: binary`; параметр `filename`), схему `Attachment`, поля `attachments`/`attachmentsMaxSize` в рассылке, `attachments` (base64) в `POST /mailings`, ответы 400/404/409/413/503, `attachments` в предпросмотре.
- [ ] **Step 3:** `npm test` — проходит.
- [ ] **Step 4: Commit** `Describe attachments in OpenAPI`

### Task 8: Блок «Вложения» в веб-интерфейсе

**Files:**
- Create: `client/src/components/AttachmentList.tsx`
- Modify: `client/src/api.ts`, `client/src/reducers/mailings.ts` (`attachments`, `attachmentsMaxSize` у `Mailing`), `client/src/components/MailingDetailView.tsx`, стили клиента (там же, где `.test-email`)

**Interfaces:**
- Produces:
  - `api.uploadAttachment(mailingId: number, file: File): Promise<AttachmentInfo>` — `fetch` с телом `file`, `Content-Type: file.type || 'application/octet-stream'`, заголовком пространства и `credentials: 'include'`, ошибки — как в `apiRequest` (вынести общую обработку ответа в функцию)
  - `api.deleteAttachment(mailingId: number, id: string): Promise<void>`
  - `api.attachmentUrl(mailingId: number, id: string): string`
  - `<AttachmentList attachments maxSize readOnly onUpload(files: File[]) onDelete(id) />`

- [ ] **Step 1:** Реализовать API-функции и компонент: список (имя — ссылка на скачивание, размер `formatSize` в КБ/МБ, ✕), кнопка «Добавить файл» (`<input type=file multiple>`), подсказка «Вложения уходят каждому получателю, всего до N МБ на письмо». `readOnly`, когда рассылка RUNNING или заблокирована (`canEdit` в `MailingDetailView`). После загрузки/удаления — перезагрузить рассылку (`reloadSingleMailing`); ошибки — `notifyAboutError` с текстом сервера (413 → «Превышен общий размер вложений»).
- [ ] **Step 2:** Встроить блок в `MailingDetailView` после `<div className='form'>` и до `.test-email`.
- [ ] **Step 3:** `npm run typecheck && npm run lint && npm run build` — без ошибок.
- [ ] **Step 4:** Проверка на стенде (`stand/`): загрузить PDF, скачать, отправить пробное письмо, увидеть вложение в письме (fakeSender/почтовый ящик стенда); удалить вложение; дублировать рассылку — вложение в копии.
- [ ] **Step 5: Commit** `Add attachments block to the mailing view`

### Task 9: Развёртывание и документация

**Files:**
- Modify: `deploy/lxc/systemd/mail-server.service` (`StateDirectory=eterfund-mail`), `deploy/lxc/config/mail-server.json` (`server.attachments.dir: /var/lib/eterfund-mail/attachments`), `deploy/lxc/README.md` (обновление юнита при переходе: `install -m 644 … /etc/systemd/system/ && systemctl daemon-reload`), `README.ru.md`, `README.md` (раздел о вложениях, параметры `server.attachments.*`, маршруты), `CHANGELOG.md` (раздел Unreleased: Added attachments)
- Test: `stand/` поднимается с новым конфигом (если стенд монтирует конфиг — добавить `attachments.dir`)

- [ ] **Step 1:** Внести изменения.
- [ ] **Step 2:** `npm run typecheck && npm run lint && npm test && npm run build` — без ошибок.
- [ ] **Step 3: Commit** `Document attachments and add the state directory for deploy`
