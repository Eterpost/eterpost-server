# Картинки в письмах: ipfs-images — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** ipfs-images и ipfs-images-components работают на Node 22, развёрнуты на CT 647, а редактор рассылки вставляет в письмо абсолютный публичный адрес картинки.

**Architecture:** components — библиотека (хранилища, метаданные в Redis, обработчики Express, превью); ipfs-images — сервер на ней. На проде: filesystem-хранилище в `/var/lib/eterfund-mail/images`, служба на 127.0.0.1:8002, nginx отдаёт `/images/` во внутреннем сервере и только `/images/dl/` на публичном имени.

**Tech Stack:** Node 22, JavaScript CommonJS, Express 5, redis 5, winston 3, sharp 0.34, kubo-rpc-client, multiparty 4.2, `node:test`.

**Spec:** `docs/specs/2026-11-10-letter-images-design.md` (задача 20032)

Репозитории: `/srv/lav/Projects/Claude/node-dev/ipfs-images-components` (C), `/srv/lav/Projects/Claude/node-dev/ipfs-images` (I), `/srv/lav/Projects/Claude/node-dev/mail-server` (M). Работа в ветке `node22` в C и I, `letter-images` в M (от `attachments`).

## Global Constraints

- Node `>=22`, CommonJS, без bluebird и fs-extra; async/await.
- Коммиты по-английски, **без** трейлера Co-Authored-By; ключи и секреты не в репозитории.
- `server.allowedTypes` по умолчанию `["image/png", "image/jpeg", "image/gif", "image/webp"]`; тип — по сигнатуре байтов; SVG не принимается.
- Отдача `/dl`: `ETag: "<hash>"`, `Cache-Control: public, max-age=<server.cache>, immutable`, `X-Content-Type-Options: nosniff`, `Content-Security-Policy: sandbox`.
- Коды: 400 (нет файла/плохая форма), 413 (больше `server.size`), 415 (тип не разрешён), 403 (auth), 404 (нет записи).
- Путь к конфигу — `IPFS_IMAGES_CONFIG`, иначе `config.json` в рабочем каталоге.
- Версии C и I — 2.0.0, теги `v2.0.0`; I зависит от `github:Eterpost/ipfs-images-components#v2.0.0`.
- Тесты с Redis — через `TEST_REDIS_URL` (как в mail-server), без него пропускаются.

## Review Focus

1. Загрузка файла с расширением `.png`, но содержимым HTML — 415, файл не сохранён. Тест: Task 3.
2. Повторная загрузка той же картинки (тот же sha256) — тот же id, ошибки нет. Тест: Task 2.
3. `If-None-Match` для несуществующего хеша — 404, не 304. Тест: Task 4.
4. Хеш в URL вида `../../etc/passwd` — 404, путь за пределы basePath не строится. Тест: Task 2.
5. Имя файла с пробелами и кириллицей в адресе картинки — редактор кодирует его, ссылка открывается. Тест: Task 8 (e2e).

---

### Task 1: C — основа: package.json, настройки, журнал, Redis

**Files:** `package.json`, `package-lock.json`, `components/settings.js`, `components/logging.js`, `components/redis.js`, `components/errors.js`, `eslint.config.js` (вместо `.eslintrc.json`), `.gitignore`; Test: `test/settings.test.js`, `test/helpers.js`

**Interfaces — Produces:**
- `settings` — объект конфига; `settings.load(path?)` перечитывает (для тестов); путь из `IPFS_IMAGES_CONFIG` или `config.json`
- `logging.getWrapperForModule(name)` → `{error, warn, info, verbose, debug}`
- `redis.getClient(): Promise<RedisClient>` — одно подключение (`settings.redis.url`), `redis.close()`
- `FileNotFoundError`, `UnsupportedTypeError`, `FileTooLargeError`, `InvalidInputError` в `errors.js`

- [ ] **Step 1:** тест: `settings.load()` читает файл из `IPFS_IMAGES_CONFIG`; без файла — ошибка с текстом `config.json`; битый JSON — `Config must be a valid JSON document`.
- [ ] **Step 2:** `npm test` (`node --test test/`) — падает.
- [ ] **Step 3:** package.json: зависимости из спека, `engines.node >=22`, scripts `test`, `lint`; удалить bluebird, fs-extra, chai, mocha, jsdoc*, prettier*. Переписать settings/logging (winston 3, транспорты console/file из конфига)/redis (redis 5).
- [ ] **Step 4:** `npm test && npm run lint` — зелёные.
- [ ] **Step 5:** commit `Move to Node 22: settings, logging and Redis client`

### Task 2: C — хранилища и метаданные

**Files:** `components/storage-backends/filesystem.js`, `components/storage-backends/ipfs.js`, `components/metadata.js`; Test: `test/filesystem.test.js`, `test/ipfs.test.js`, `test/metadata.test.js`

**Interfaces — Produces:**
- `FilesystemStorage(basePath)`: `add({path}) → Promise<hash>` (sha256 hex), `get(hash) → Promise<Readable>` (нет файла — `FileNotFoundError`), `delete(hash)`, `has(hash) → Promise<boolean>`; хеш не из `/^[0-9a-f]{64}$/` — `FileNotFoundError`
- `IpfsStorage(url, { create? })`: те же методы + `pin`, `getLocalObjects`; клиент — `kubo-rpc-client` через `import()`, `create` — подмена для тестов
- `Metadata`: `addRecord(hash, mimetype, size)`, `getRecord(hash)` (нет — `FileNotFoundError`), `delRecord(hash)`

- [ ] **Step 1:** тесты: add→get возвращает то же содержимое; повторный add того же содержимого — тот же хеш; `get('../../etc/passwd')` и `get('0'.repeat(64))` — `FileNotFoundError`; delete; IpfsStorage с подменённым клиентом вызывает add/pin/cat/pin.rm; Metadata (Redis): add/get/del, индекс `zAdd`.
- [ ] **Step 2:** падают. **Step 3:** реализовать. **Step 4:** зелёные. **Step 5:** commit `Port storage backends and metadata to async code`

### Task 3: C — загрузка с проверкой типа

**Files:** `components/file-type.js`, `components/handlers/upload.js`; Test: `test/file-type.test.js`, `test/upload.test.js`

**Interfaces — Produces:**
- `detectImageType(buffer: Buffer): string | null` — png `89 50 4E 47 0D 0A 1A 0A`, jpeg `FF D8 FF`, gif `GIF87a`/`GIF89a`, webp `RIFF....WEBP`
- `upload(storage, metadata, { MAX_FILE_SIZE, ALLOWED_TYPES })` — Express handler; ответ `{id, filename, mime}`; 400/413/415; временный файл удаляется всегда

- [ ] **Step 1:** тесты: сигнатуры четырёх форматов и null для HTML/SVG; через Express + fetch с FormData: png → 200 и `mime: image/png` даже при `Content-Type: text/plain` у части; HTML с именем `x.png` → 415, в хранилище пусто; больше лимита → 413; без поля `file` → 400.
- [ ] **Step 2–4:** RED → реализовать (multiparty 4.2, `maxFilesSize`) → GREEN.
- [ ] **Step 5:** commit `Accept only allowed image types on upload`

### Task 4: C — отдача, превью, удаление, обслуживание

**Files:** `components/handlers/download.js`, `download_thumb.js`, `del_attachment.js`, `components/thumbnail.js`, `components/cleaner.js`, `components/pin.js`, `index.js`, `README.md`, `CHANGELOG.md`; Test: `test/download.test.js`, `test/thumbnail.test.js`

**Interfaces — Produces:** `download(storage, metadata, { CACHE_DURATION })`, `downloadThumb(thumbnail, metadata, { CACHE_DURATION })`, `delAttachment(storage, metadata)` (удаляет и метаданные), `new Thumbnail(storage, settings.thumbnails)`.serve(hash, size) → Promise<Readable>; `Cleaner`, `Pin` принимают storage/клиент параметром.

- [ ] **Step 1:** тесты: dl → 200, тип из метаданных, ETag, Cache-Control, nosniff, CSP sandbox; `If-None-Match` с ETag → 304; с ETag несуществующего хеша → 404; нет записи → 404; thumb → jpeg ширины ≤ size (sharp metadata); del → файл и запись удалены, повтор → 404.
- [ ] **Step 2–4:** RED → реализовать (sharp 0.34: `resize(size, size, {fit:'contain', background:{r:255,g:255,b:255,alpha:0}}).flatten({background:'#fff'}).jpeg()`) → GREEN.
- [ ] **Step 5:** README (что это, конфиг, API, тесты), CHANGELOG 2.0.0, `npm version 2.0.0 --no-git-tag-version`; commit `Serve images with ETag and safe headers; release 2.0.0`; тег `v2.0.0` — после ревью.

### Task 5: I — сервер на новых components

**Files:** `package.json`, `package-lock.json`, `server.js`, `routes.js`, `auth.js`, `config.json.example`, `eslint.config.js`, `README.md`, `CHANGELOG.md`; Test: `test/routes.test.js`

**Interfaces — Consumes:** Task 1–4. **Produces:** `createApp(settings) → Express` в `routes.js` (server.js только слушает порт).

- [ ] **Step 1:** тесты (filesystem-хранилище во временном каталоге, Redis): `auth.type: partial`, allowedIPs только `^10\.` → `/ul` и `/del` 403 с 127.0.0.1, `/dl` открыт; allowedIPs с 127.0.0.1 → загрузка и отдача работают; `/api/integrity` → 404.
- [ ] **Step 2–4:** RED → Express 5, `auth` как функция-проверка без Promise-конструктора, `/del` под auth, убрать integrity, зависимость на components — `file:../ipfs-images-components` на время разработки → GREEN.
- [ ] **Step 5:** README, CHANGELOG 2.0.0, версия 2.0.0; commit `Move to Node 22 and ipfs-images-components 2.0`.

### Task 6: M — развёртывание ipfs-images

**Files:** `deploy/lxc/update.sh` (проект `ipfs-images`, репозиторий `ipfs-images`, сборка `npm ci --omit=dev`, без build), `deploy/lxc/systemd/ipfs-images.service`, `deploy/lxc/config/ipfs-images.json`, `deploy/lxc/nginx/eterfund-mail.conf` (`/images/` внутри, `/images/dl/` снаружи), `deploy/lxc/install.sh`, `deploy/lxc/README.md` (раздел «Картинки в письмах»)

- [ ] **Step 1:** `sh -n update.sh install.sh`; `update.sh -h` показывает ipfs-images; `nginx -t` в docker на примере конфига.
- [ ] **Step 2:** commit `Deploy ipfs-images next to mail-server`

### Task 7: M — клиент: абсолютный адрес картинки

**Files:** `client/src/components/RichTextEditor.tsx`, `client/webpack.config.js` (константа `IMAGE_PUBLIC_URL`), `client/src/globals.d.ts`, `config.default.json`, `deploy/lxc/config/mail-server.json`, README ru/en

- [ ] **Step 1:** функция `imageUrl(publicUrl, serviceUrl, id, filename)` в `client/src/imageUrl.ts` + тест в `server/tests` нельзя (клиент) — проверка e2e в Task 8; typecheck, lint, build.
- [ ] **Step 2:** ошибки загрузки: 415 → «Можно вставлять только картинки PNG, JPEG, GIF, WebP», 413 → «Картинка слишком большая», иначе прежний текст.
- [ ] **Step 3:** commit `Insert absolute public image addresses into letters`

### Task 8: M — стенд

**Files:** `stand/compose.yml` (сервис images из `../../ipfs-images` + components), `stand/config/ipfs-images.json`, `stand/config/nginx.conf`, `stand/e2e/1-images.test.js`, `stand/README.md`

- [ ] **Step 1:** e2e: загрузка png через `CLIENT_URL/images/ul` → id; `GET /images/dl/<id>/Картинка%20один.png` → 200, `image/png`, nosniff; HTML → 415.
- [ ] **Step 2:** `./run.sh` — все e2e зелёные.
- [ ] **Step 3:** commit `Check letter images on the test stand`

### Task 9: публикация и прод (после ревью, по согласованию)

- [ ] Репозитории Eterpost/ipfs-images(-components) созданы (сессия lavtomate); remotes `pub.github`, `pub.gitlab`; в I зависимость `github:Eterpost/ipfs-images-components#v2.0.0`; теги `v2.0.0`; `gpush` — по просьбе пользователя.
- [ ] Прод: `/etc/eterfund-mail/ipfs-images.json`, юнит, nginx CT 647 (с копиями `.bak-<дата>`), `update.sh ipfs-images`; фронт eterhost `/images/dl/` — через админ-сессию; mail-server с `client.imagePublicUrl`.
