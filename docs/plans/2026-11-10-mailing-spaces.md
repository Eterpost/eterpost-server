# Пространства рассылок — план реализации

> **Для исполнителя:** задачи выполнять по порядку, шаги отмечены `- [ ]`.
> Каждая задача — свой тестовый цикл и свой коммит (сообщения коммитов — на
> английском, без Co-Authored-By).

**Цель:** изолировать рассылки по пространствам (ключ API → пространство,
веб — по участникам), пометить пробные рассылки, задать From на пространство,
отписку письмом ограничить пространством.

**Архитектура:** пространства и участники — новый `SpaceRepository` в Redis.
`apiKeyAuth` вычисляет доступ запроса (`SpaceAccess`) по роли ключа,
`X-Remote-User` и `X-Eterpost-Space`. Одна промежуточная функция `loadMailing`
загружает рассылку и прячет чужую (404); контроллеры берут рассылку из
`res.locals.mailing`.

**Стек:** Node 22, TypeScript, Express 5, node-redis, node:test; клиент —
React 18 + Redux; mail-sorter — JavaScript (CommonJS).

**Спецификация:** `docs/specs/2026-11-10-mailing-spaces-design.md`
(задача https://bugs.etersoft.ru/show_bug.cgi?id=20010).

## Общие требования

- Имя пространства: `/^[a-z0-9][a-z0-9-]{0,31}$/`; пространство по умолчанию —
  `default`.
- Заголовок текущего пространства: `X-Eterpost-Space`.
- Рассылка чужого пространства — 404 `Mailing not found` (как несуществующая).
- Пространство, к которому нет доступа, в заголовке — 403
  `SPACE_FORBIDDEN`.
- Ключи Redis: `SPACES` (hash имя → JSON `{title, from, createdAt}`),
  `SPACE_MEMBERS_<имя>` (set логинов); префиксы — через
  `config.server.redis.prefixes`, как у ключей API.
- Администраторы — `server.auth.admins: string[]` (логины), по умолчанию `[]`.
- Подстановка номера рассылки в `server.mail.listUnsubscribe` — `{id}`.
- Фильтр рассылок — `?kind=live|test|all`, по умолчанию в API `all`, в
  веб-интерфейсе `live`.
- Совместимость: старые ключи без роли работают со всеми пространствами и пишут
  предупреждение; запрос без ключа при `auth.required: false` — тоже все.
- Redis-тесты запускаются с `TEST_REDIS_URL` (временный контейнер
  `redis:7-alpine` на 127.0.0.1:16399).
- Перед каждым коммитом: `npm run lint`, `npm run typecheck`, `npm test`.

## На что смотреть при проверке

1. **Обновление без простоя:** после выкладки старые ключи mail-sorter,
   subscription-facade и фронта работают как раньше, веб показывает `default`
   (тест в задаче 3).
2. **Ключ прокси без `X-Remote-User`** или пользователь без пространств — пустой
   список рассылок, создание — 403, а не доступ ко всему (тест в задаче 3).
3. **Чужая рассылка через побочные маршруты** — `create-retry`/`sourceId`,
   `restore-excluded`, `results`, `preview`, `DELETE`, `/mailings/:mailingId/unsubscribe`
   — везде 404 (тест в задаче 5).
4. **Отписка письмом с номером удалённой рассылки:** пространство неизвестно —
   исключать из всех пространств, человек хочет отписаться (тест в задаче 6).
5. **`X-Eterpost-Space` с несуществующим пространством** — 403, как чужое, без
   подсказки, существует ли оно (тест в задаче 3).

---

### Задача 1: хранилище пространств

**Файлы:**
- Создать: `server/src/SpaceRepository.ts`
- Тест: `server/tests/SpaceRepository.test.ts`

**Интерфейсы:**
- Создаёт:
  ```ts
  export const SPACE_NAME_PATTERN = /^[a-z0-9][a-z0-9-]{0,31}$/;
  export const DEFAULT_SPACE = 'default';
  export interface Space { name: string; title?: string; from?: string; createdAt: string }
  export class SpaceRepository {
    constructor (pool: RedisConnectionPool, config?: Partial<SpaceRepositoryConfig>);
    add (space: Omit<Space, 'createdAt'>): Promise<boolean>;      // false — уже есть
    get (name: string): Promise<Space | null>;
    list (): Promise<Space[]>;                                      // по имени
    update (name: string, patch: { title?: string, from?: string }): Promise<boolean>;
    remove (name: string): Promise<boolean>;                        // и участников
    addMember (name: string, login: string): Promise<boolean>;      // false — нет пространства
    removeMember (name: string, login: string): Promise<boolean>;
    getMembers (name: string): Promise<string[]>;
    getSpacesOfUser (login: string): Promise<string[]>;
    hasAnyMembers (): Promise<boolean>;
  }
  ```

- [ ] **Шаг 1: тесты** (`redisSkip`, как в `RedisAddressStatsRepository.test.ts`):
  `add` дважды → `true`, `false`; `get` возвращает `title`, `from`, `createdAt`;
  `update` несуществующего → `false`; `addMember('sales','ivan')`,
  `addMember('news','ivan')` → `getSpacesOfUser('ivan')` = `['news','sales']`;
  `addMember` в несуществующее → `false`; `hasAnyMembers()` до и после первого
  участника → `false`, `true`; `remove('sales')` → `getSpacesOfUser('ivan')` =
  `['news']`.
- [ ] **Шаг 2:** `npm test` — тесты падают (нет модуля).
- [ ] **Шаг 3: реализовать.** `getSpacesOfUser` — перебор `list()` и
  `sIsMember`: пространств единицы.
- [ ] **Шаг 4:** `npm test` — проходят.
- [ ] **Шаг 5: коммит** `Add a repository of mailing spaces and their members`.

### Задача 2: роли ключей API

**Файлы:**
- Изменить: `server/src/ApiKeyRepository.ts`, `server/src/apiKeysCli.ts`
- Тест: `server/tests/ApiKeyRepository.test.ts` (создать, если нет; иначе
  дополнить)

**Интерфейсы:**
- Создаёт:
  ```ts
  export interface ApiKeyRole { proxy?: boolean; space?: string; system?: boolean }
  // ApiKeyRecord дополняется полями space?: string, system?: boolean
  add (name: string, role?: ApiKeyRole): Promise<string | null>;   // было (name, proxy?)
  setRole (name: string, role: ApiKeyRole): Promise<boolean>;
  export function isLegacyKey (record: ApiKeyRecord): boolean;     // ни proxy, ни space, ни system
  ```

- [ ] **Шаг 1: тесты:** `add('site', {space:'sales'})` → `findByKey` даёт
  `space: 'sales'`; `setRole('old', {system:true})` → `system: true`, `space`
  нет; `setRole` неизвестного → `false`; `isLegacyKey` для записи без ролей →
  `true`, с `proxy`/`space`/`system` → `false`.
- [ ] **Шаг 2:** `npm test` — падают.
- [ ] **Шаг 3: реализовать.** Роли взаимоисключающие: в `add`/`setRole` больше
  одной — исключение `Error('Choose one role')`. CLI: `add <имя>
  --space <п> | --system | --proxy`, `set-role <имя> --space <п> | --system |
  --proxy`; `list` печатает роль (`proxy`, `system`, `space:<п>`, `legacy`).
  Пространство в `--space` CLI проверяет через `SpaceRepository.get` (ошибка,
  если его нет).
- [ ] **Шаг 4:** `npm test` — проходят.
- [ ] **Шаг 5: коммит** `Give API keys a space, system or proxy role`.

### Задача 3: доступ запроса к пространствам

**Файлы:**
- Создать: `server/src/middleware/spaceAccess.ts`
- Изменить: `server/src/middleware/apiKeyAuth.ts` (вызов и `Actor`),
  `server/src/routes.ts`, `server/src/index.ts`, `server/src/validateConfig.ts`
  (`auth.admins`), `config.default.json`
- Тест: `server/tests/spaceAccess.test.ts`, дополнить `server/tests/apiKeyAuth.test.ts`

**Интерфейсы:**
- Создаёт:
  ```ts
  export interface SpaceAccess {
    allowed: string[] | 'all';
    current?: string;          // из ключа пространства или заголовка
    legacy?: boolean;          // старый ключ или запрос без ключа
    system?: boolean;
  }
  export class SpaceForbiddenError extends Error {}
  export async function resolveSpaceAccess (
    record: ApiKeyRecord | null, user: string | undefined, requested: string | undefined,
    spaces: SpaceRepository, admins: string[]
  ): Promise<SpaceAccess>;     // SpaceForbiddenError — нет доступа к requested
  export function canSee (access: SpaceAccess, space: string | undefined): boolean;
  // пространство рассылки без поля space — DEFAULT_SPACE
  export function listedSpaces (access: SpaceAccess): string[] | 'all';
  // current ? [current] : allowed
  export function spaceForNewMailing (access: SpaceAccess): string | null;
  // current; иначе единственный из allowed; 'all' → DEFAULT_SPACE; иначе null
  export function getSpaceAccess (res: Response): SpaceAccess;     // res.locals.spaceAccess
  ```
- `apiKeyAuth` получает дополнительные параметры `spaces: SpaceRepository,
  admins: string[]`, кладёт `res.locals.spaceAccess`; на `SpaceForbiddenError`
  отвечает 403 `{code: 'SPACE_FORBIDDEN'}`. Старый ключ — `logger.warn`
  `API key "<имя>" has no role` не чаще раза в 10 минут на ключ (как
  `logAnonymous`).

- [ ] **Шаг 1: тесты `resolveSpaceAccess`** (с поддельным `SpaceRepository`):
  - ключ `{space:'sales'}` → `{allowed:['sales'], current:'sales'}`; с
    заголовком `news` → `SpaceForbiddenError`;
  - `{system:true}` → `allowed:'all'`, `system:true`; с заголовком `news` →
    `current:'news'`;
  - старый ключ и `null` → `allowed:'all'`, `legacy:true`;
  - прокси, `user:'ivan'` в `sales` и `news`, без заголовка →
    `allowed:['news','sales']`, `current` нет; с заголовком `sales` →
    `current:'sales'`; с заголовком `nope` (нет такого) → `SpaceForbiddenError`;
  - прокси без `user` → `allowed:[]`;
  - прокси, `user:'lav'` в `admins` → `allowed:'all'`;
  - прокси, `hasAnyMembers() === false` → `allowed:['default']`.
- [ ] **Шаг 2: тесты помощников:** `canSee({allowed:['sales']}, undefined)` →
  `false`, `canSee({allowed:['default']}, undefined)` → `true`;
  `spaceForNewMailing({allowed:[]})` → `null`,
  `({allowed:'all'})` → `'default'`, `({allowed:['a','b']})` → `null`.
- [ ] **Шаг 3: тест `apiKeyAuth`:** заголовок с чужим пространством → 403
  `SPACE_FORBIDDEN`; старый ключ пишет предупреждение один раз за два запроса.
- [ ] **Шаг 4:** `npm test` — падают.
- [ ] **Шаг 5: реализовать**, `admins` берётся из `config.server.auth.admins ?? []`,
  схема конфига принимает массив строк.
- [ ] **Шаг 6:** `npm test` — проходят.
- [ ] **Шаг 7: коммит** `Work out which mailing spaces a request may use`.

### Задача 4: пространство и признак пробы у рассылки

**Файлы:**
- Изменить: `server/src/Mailing.ts`, `server/src/RedisMailingRepository.ts`,
  `server/src/MailingRepository.ts`, `server/src/index.ts`
- Создать: `server/src/migrateSpaces.ts`
- Тест: дополнить `server/tests/RedisMailingRepository.test.ts`, создать
  `server/tests/migrateSpaces.test.ts`

**Интерфейсы:**
- `MailingProperties` и `Mailing`: `space?: string` (в `Mailing` — `space: string`,
  по умолчанию `DEFAULT_SPACE`), `test?: boolean` (в `Mailing` — `test: boolean`,
  по умолчанию `false`). Сохраняются `create()` и `update()`, читаются
  `parseEntity`.
- `export async function migrateMailingsToDefaultSpace (repository: MailingRepository): Promise<number>`
  — дописывает `space: 'default'` рассылкам без поля, возвращает их число;
  `index.ts` вызывает при запуске и пишет в журнал, если число > 0.

- [ ] **Шаг 1: тесты:** `create({..., space:'sales', test:true})` → `getById`
  возвращает те же `space` и `test`; рассылка, записанная в Redis без `space`
  (сырой JSON), → `getById().space === 'default'`; миграция на двух рассылках
  (одна без `space`) → `1`, повторный запуск → `0`.
- [ ] **Шаг 2:** `npm test` — падают.
- [ ] **Шаг 3: реализовать.**
- [ ] **Шаг 4:** `npm test` — проходят.
- [ ] **Шаг 5: коммит** `Keep the space and the test flag of a mailing`.

### Задача 5: изоляция маршрутов рассылок

**Файлы:**
- Создать: `server/src/middleware/loadMailing.ts`
- Изменить: `server/src/routes.ts`, все контроллеры с `:id`/`:mailingId`
  (`getMailing`, `updateMailing`, `getReceivers`, `getFailedReceivers`,
  `getResults`, `sendTestEmail`, `previewEmail`, `restoreExcluded`,
  `deleteMailing`, `requestSubscription`, `subscribe`, `unsubscribe`,
  `deleteReceiver`), `getMailings`, `addMailing`, `createRetryMailing`,
  `server/src/openapi.ts`
- Тест: `server/tests/spaceIsolation.test.ts`

**Интерфейсы:**
- Создаёт:
  ```ts
  export function loadMailing (repository: MailingRepository, param: 'id' | 'mailingId' = 'id'):
    RequestHandler;   // 400 Invalid ID, 404 Mailing not found (нет или !canSee), иначе res.locals.mailing
  export function getLoadedMailing (res: Response): Mailing;
  ```
- `GET /mailings`: фильтр `listedSpaces(access)` и `kind` (`live` — `!test`,
  `test` — `test`, `all`); неверный `kind` — 400. В ответе у рассылки поля
  `space` и `test`.
- `POST /mailings`: `space = spaceForNewMailing(access)`, `null` → 403
  `SPACE_REQUIRED`; `sourceId` чужого пространства → 404; поле `test` в схеме.
  `PUT /mailings/:id` принимает `test`.
- `POST /mailings/create-retry`: исходная рассылка — через `canSee`, новая — в
  пространстве исходной.
- `openapi.ts`: `X-Eterpost-Space` как параметр, `kind`, поля `space`, `test`;
  `openapi.test` проходит.

- [ ] **Шаг 1: тесты** (supertest-подобный вызов через `createExpressServer`, как
  в `apiKeyAuth.test.ts`; ключи `sales-key {space:'sales'}`, `news-key
  {space:'news'}`, `sys-key {system:true}`):
  - `sales-key` создаёт рассылку → `space:'sales'`; `news-key` на `GET`,
    `PUT`, `DELETE /mailings/:id`, `/receivers`, `/failed-receivers`,
    `/results`, `/preview`, `/send-test-email`, `/restore-excluded`,
    `/mailings/:mailingId/unsubscribe` — 404;
  - `news-key`: `POST /mailings {sourceId: <рассылка sales>}` и
    `create-retry` с ней — 404;
  - `GET /mailings` для `news-key` не содержит рассылку sales; `sys-key` без
    заголовка — содержит обе;
  - `kind`: пробная и боевая в sales → `kind=live` одна, `kind=test` одна,
    без `kind` — две, `kind=x` — 400;
  - прокси без `X-Remote-User`, когда участники заведены: `GET /mailings` →
    `[]`, `POST /mailings` → 403 `SPACE_REQUIRED`.
- [ ] **Шаг 2:** `npm test` — падают.
- [ ] **Шаг 3: реализовать;** контроллеры перестают сами читать
  `repository.getById(req.params.id)` и берут `getLoadedMailing(res)`.
- [ ] **Шаг 4:** `npm test`, `npm run lint`, `npm run typecheck` — проходят.
- [ ] **Шаг 5: коммит** `Show and change mailings only within their space`.

### Задача 6: отписка письмом в пределах пространства

**Файлы:**
- Изменить: `server/src/MailingExecutor.ts` (заголовок),
  `server/src/controllers/unsubscribeFromAll.ts`, `server/src/openapi.ts`
- Тест: дополнить `server/tests/MailingExecutor.test.ts`, создать
  `server/tests/unsubscribeFromAll.test.ts`

**Интерфейсы:**
- `List-Unsubscribe` = `config.server.mail.listUnsubscribe.replaceAll('{id}', String(mailing.id))`.
- `POST /mailings/unsubscribe` принимает `mailingId?: number`. Доступ — только
  `access.system || access.legacy`, иначе 403. С `mailingId` и найденной
  рассылкой — только рассылки её пространства; без `mailingId` или с
  несуществующей рассылкой — все.

- [ ] **Шаг 1: тесты:** с `listUnsubscribe: '<mailto:noreply+unsubscribe-{id}@example.com>'`
  письмо рассылки 7 несёт `<mailto:noreply+unsubscribe-7@example.com>`; без
  `{id}` — строка как есть. Адрес в рассылках sales и news:
  `{email, listUnsubscribe:true, mailingId:<sales>}` → `removed:1`, в news
  остался; `mailingId: 99999` → `removed:2`; ключ пространства → 403.
- [ ] **Шаг 2:** `npm test` — падают.
- [ ] **Шаг 3: реализовать.**
- [ ] **Шаг 4:** `npm test` — проходят.
- [ ] **Шаг 5: коммит** `Unsubscribe by mail only from the space of the mailing`.

### Задача 7: From пространства и список пространств

**Файлы:**
- Изменить: `server/src/MailingExecutor.ts` (конструктор получает
  `SpaceRepository`), `server/src/controllers/previewDraft.ts`, `server/src/index.ts`,
  `server/src/routes.ts`, `server/src/openapi.ts`
- Создать: `server/src/controllers/getSpaces.ts`
- Тест: дополнить `server/tests/MailingExecutor.test.ts`, создать
  `server/tests/getSpaces.test.ts`

**Интерфейсы:**
- From письма: `mailing.from || (await spaces.get(mailing.space))?.from` —
  дальше `composeMessage` подставит `server.mail.from`. `previewDraft` — то же
  для `spaceForNewMailing(access)`.
- `GET /spaces` → `[{ name, title, from }]` для `listedSpaces`; при `'all'` —
  все из `SpaceRepository.list()` (и `default`, даже если не заведено).

- [ ] **Шаг 1: тесты:** пространство `sales` с `from: 'Sales <sales@example.com>'`:
  рассылка без `from` → письмо от `Sales <sales@example.com>`, `sender` —
  адрес сервиса; рассылка с `from` → её адрес; пространство без `from` →
  `server.mail.from`. `GET /spaces`: ключ `sales` → только sales; прокси-админ
  → все.
- [ ] **Шаг 2:** `npm test` — падают.
- [ ] **Шаг 3: реализовать.**
- [ ] **Шаг 4:** `npm test` — проходят.
- [ ] **Шаг 5: коммит** `Send from the space address and list spaces of the user`.

### Задача 8: CLI пространств и документация перехода

**Файлы:**
- Создать: `server/src/spacesCli.ts`
- Изменить: `README.md`, `README.ru.md`, `deploy/lxc/README.md`,
  `config.default.json` (пример `{id}` и `auth.admins`)

**Интерфейсы:**
- Команды (`node server/dist/src/spacesCli.js`): `add <имя> [--title] [--from]`,
  `set <имя> [--title] [--from]`, `list`, `members <имя>`,
  `add-member <имя> <логин>`, `remove-member <имя> <логин>`, `remove <имя>`
  (отказ, если есть рассылки этого пространства). Имя проверяется
  `SPACE_NAME_PATTERN`.

- [ ] **Шаг 1:** реализовать по образцу `apiKeysCli.ts`; проверить вручную на
  временном Redis: `add sales --from 'Sales <sales@example.com>'`, `list`,
  `add-member sales ivan`, `members sales`, `remove sales` при рассылке
  пространства — отказ.
- [ ] **Шаг 2:** документация: пространства, роли ключей, `X-Eterpost-Space`,
  `kind`, From, `{id}`; в deploy/lxc — порядок перехода из спецификации
  (раздел «Переход для работающей установки»).
- [ ] **Шаг 3: коммит** `Manage mailing spaces from the command line`.

### Задача 9: mail-sorter — номер рассылки в адресе отписки

**Файлы (репозиторий mail-sorter):**
- Изменить: `src/MessageClassifier.js`, `src/handlers/UnsubscribeMessageHandler.js`,
  `src/databases/MailServerDatabase.js`, `MultiDatabase.js`, `DummyDatabase.js`,
  `GenericMySqlDatabase.js` (принимают и игнорируют второй аргумент), README
- Тест: `tests/MessageClassifier.test.js` (создать), дополнить
  `tests/MailServerDatabase.test.js`

**Интерфейсы:**
- `MessageClassifier.getUnsubscribeMailingId(message): number | undefined` —
  из `<user>+unsubscribe-<номер>@`; `_isUnsubscribe` принимает и
  `unsubscribe`, и `unsubscribe-<номер>`.
- `unsubscribeAddress(address, mailingId?)`; `MailServerDatabase` добавляет
  `mailingId` в тело `POST /mailings/unsubscribe`.

- [ ] **Шаг 1: тесты:** `noreply+unsubscribe-42@example.com` → тип UNSUBSCRIBE,
  номер 42; `noreply+unsubscribe@…` → UNSUBSCRIBE без номера;
  `noreply+unsubscribe-x@…` → не отписка; тело запроса содержит
  `mailingId: 42`.
- [ ] **Шаг 2:** `npm test` — падают.
- [ ] **Шаг 3: реализовать.**
- [ ] **Шаг 4:** `npm test`, `npm run lint` — проходят.
- [ ] **Шаг 5: коммит** `Pass the mailing number from the unsubscribe address`.

### Задача 10: веб-интерфейс

**Файлы:**
- Изменить: `client/src/api.ts` (заголовок, `getSpaces`, `kind`),
  `client/src/reducers/ui.ts`, `client/src/MailingApp.tsx`,
  `client/src/components/MailingList.tsx`, `AddForm.tsx`, `MailingDetailView.tsx`
- Создать: `client/src/components/SpaceSwitcher.tsx`, `client/src/actions/loadSpaces.ts`

**Интерфейсы:**
- `apiRequest` добавляет `X-Eterpost-Space: <текущее>`, если оно выбрано.
- Текущее пространство: `?space=` в адресе → `localStorage` (`eterpost.space`,
  в try/catch) → первое из `GET /spaces`. Смена — перезагрузка списка рассылок
  и сброс выбранной рассылки.
- Фильтр «Боевые / Пробные / Все» над списком, в адресе `?kind=`, по умолчанию
  `live`; у пробной рассылки в списке метка «проба».
- В форме рассылки: флажок «Пробная»; поле From пустое с placeholder — From
  пространства (или «как у сервиса»).
- Пустой `GET /spaces` — вместо списка текст «Вас ещё не добавили ни в одно
  пространство. Обратитесь к администратору».

- [ ] **Шаг 1:** реализовать.
- [ ] **Шаг 2:** `npm run lint`, `npm run typecheck`, `npm run client:build`.
- [ ] **Шаг 3: проверка вживую** (локальный стенд из README: mail-server на
  18765, статический клиент на 18766, headless Chromium): два пространства,
  переключение меняет список, `?space=` в ссылке открывает нужное, фильтр
  проб, From-подсказка, пустой список пространств — сообщение. Светлая и
  тёмная тема, ширина телефона.
- [ ] **Шаг 4: коммит** `Switch mailing spaces and filter test mailings in the client`.

### Задача 11: сквозная проверка на стенде

**Файлы:**
- Изменить: `stand/` (ключи mail-sorter и facade — `--system`, сайт — `--space`,
  `listUnsubscribe` с `{id}`), сквозные тесты стенда

- [ ] **Шаг 1:** дополнить сквозной тест: рассылки в двух пространствах,
  отписка письмом на `noreply+unsubscribe-<id>@` исключает адрес только в своём
  пространстве; подписка и отписка по ссылке через facade работают.
- [ ] **Шаг 2:** `stand/run.sh` — все тесты проходят.
- [ ] **Шаг 3: коммит** `Check mailing spaces end to end on the stand`.
