# Картинки в письмах рассылок: ipfs-images

Задача: https://bugs.etersoft.ru/show_bug.cgi?id=20032

## Зачем

Кнопка «вставить картинку» в редакторе рассылки загружает файл в сервис
ipfs-images (`client.imageServiceUrl`) и вставляет адрес картинки в HTML письма.
Сейчас это не работает:

- на проде (CT 647) ipfs-images не развёрнут, `/images` в nginx нет;
- редактор вставляет относительный адрес (`/images/dl/...`): у получателя письма
  он не откроется;
- ipfs-images (2018) на Node 22 не запускается: sharp 0.17 (нативная сборка),
  ipfs-api 14, redis 2.7, winston 2, Express 4.15.

Готово, когда: картинка, вставленная в редакторе, попадает в письмо абсолютным
адресом `https://subscribe.eterhost.ru/images/dl/<hash>/<имя>`, и пробное письмо
показывает её в почтовом клиенте снаружи сети.

## Репозитории

Два репозитория, как и были, с сохранённой историей:

| Репозиторий | Источник | Публикация |
|---|---|---|
| `ipfs-images-components` | gitlab.eterfund.ru/ipfs-images/ipfs-images-components | GitHub `Eterpost/ipfs-images-components` |
| `ipfs-images` | gitlab.eterfund.ru/ipfs-images/ipfs-images | GitHub `Eterpost/ipfs-images` |

Публикация — `gpush` (remotes `pub.github`, `pub.gitlab`, как у eterpost-*).
`ipfs-images` зависит от components по тегу на GitHub
(`github:Eterpost/ipfs-images-components#vX.Y.Z`), а не по `git+ssh` на gitlab:
сборка на сервере идёт без ключей gitlab. Версии — semver с тегами, как у
eterpost-*; первая обновлённая версия обоих — 2.0.0 (несовместимые изменения).

## Обновление под Node 22

Код остаётся JavaScript CommonJS. Функции сохраняются: загрузка, отдача,
превью, удаление, хранилища filesystem и IPFS, метаданные в Redis.

| Было | Стало |
|---|---|
| Express 4.15 | Express 5 |
| bluebird, fs-extra | async/await, `node:fs/promises` |
| redis 2.7 (promisifyAll) | redis 5 (promise API) |
| winston 2 | winston 3 |
| sharp 0.17 | sharp 0.34 (готовые сборки linux-x64) |
| ipfs-api 14 | kubo-rpc-client (ESM: подключается через `import()`) |
| multiparty 4.1 | multiparty 4.2 |
| mocha 3 + chai | `node:test` |
| `engines` нет | `"node": ">=22"` |

Настройки читаются из `config.json` в рабочем каталоге, как сейчас; путь можно
задать переменной `IPFS_IMAGES_CONFIG` (для systemd — файл в
`/etc/eterfund-mail`).

## Исправления

1. **Кэширование.** Сейчас любой запрос с `If-Modified-Since` получает 304 с
   `Last-Modified: NaN`, даже для несуществующего файла. Стало: содержимое
   неизменно (адрес — хеш), ответ с `ETag: "<hash>"` и
   `Cache-Control: public, max-age=<cache>, immutable`; 304 — только если
   `If-None-Match` совпадает с ETag и запись существует.
2. **Удаление.** `DELETE /del/:hash` закрыт той же проверкой, что `/ul`, при
   `auth.type` `partial` и `full`.
3. **`/api/integrity`** ссылается на несуществующую `checkIntegrity` — маршрут
   удаляется (функции не было ни в одной версии).
4. **Превью.** `resizer.on('end', resolve(...))` вызывает `resolve` сразу —
   превью отдаётся потоком sharp, ошибка sharp отдаёт исходную картинку, как
   задумано.
5. **Только картинки по умолчанию.** `server.allowedTypes` (по умолчанию
   `image/png`, `image/jpeg`, `image/gif`, `image/webp`). Тип определяется по
   первым байтам файла (сигнатуры этих форматов), а не по заголовку формы;
   другой тип — 415. SVG не принимается: в нём бывают скрипты.
6. **Безопасная отдача.** Все ответы `/dl` — с `X-Content-Type-Options: nosniff`
   и `Content-Security-Policy: sandbox`; `Content-Type` — из метаданных
   (определённый при загрузке тип).
7. Ошибки разбора формы и слишком большой файл — 400 и 413 вместо 500.

## API (без изменений по форме)

- `POST /ul` — multipart, поле `file`; ответ `{id, filename, mime}`;
- `GET /dl/:hash/:filename` — файл;
- `GET /dl/thumb/:size/:hash` — превью (jpeg);
- `DELETE /del/:hash` — удалить.

## Развёртывание на CT 647

- `update.sh` (mail-server, `deploy/lxc`) знает проект `ipfs-images`
  (репозиторий `Eterpost/ipfs-images`), ставит его в
  `/opt/eterfund-mail/ipfs-images` релизами, как остальные; `all` включает его.
- Служба `ipfs-images.service`: `User=mailing`, `ProtectSystem=strict`,
  `StateDirectory=eterfund-mail`, `ExecStart=node server.js`,
  `IPFS_IMAGES_CONFIG=/etc/eterfund-mail/ipfs-images.json`.
- Конфиг (`deploy/lxc/config/ipfs-images.json`): порт 8002 на 127.0.0.1;
  `storage.type: filesystem`, `basePath: /var/lib/eterfund-mail/images`;
  Redis — локальный, `prefix.attachments: IMAGES_`,
  `index.datetime: IMAGES.DATETIME.INDEX`; превью без кэша на диске; журнал —
  в консоль (journald); `auth.type: partial`, `allowedIPs: ["127\\.0\\.0\\.1",
  "::1", "::ffff:127\\.0\\.0\\.1"]`.
- nginx, внутренний сервер (веб-интерфейс): `location /images/` →
  `127.0.0.1:8002/`. Загружают те, кто входит в веб-интерфейс: проверку входа
  делает фронт, как для `/api/`.
- nginx, публичное имя подписки: только `location /images/dl/` →
  `127.0.0.1:8002/dl/`. Тот же путь — на фронте eterhost (передаётся
  админ-сессии), иначе снаружи 404.
- `install.sh` ставит юнит и конфиг из примера; README deploy — раздел перехода.

## mail-server

- Новый параметр `client.imagePublicUrl` — публичный адрес ipfs-images
  (`https://subscribe.eterhost.ru/images`). Редактор загружает в
  `imageServiceUrl` (`/images`, через веб-интерфейс), а в письмо вставляет
  `imagePublicUrl + '/dl/' + id + '/' + encodeURIComponent(имя)`. Без
  `imagePublicUrl` — как раньше (`imageServiceUrl`), с предупреждением в
  README.
- Ошибка загрузки (415 — не картинка, 413 — велика) — понятным сообщением
  вместо `alert('Не удалось загрузить картинку.')`.
- Стенд: служба ipfs-images (filesystem), nginx стенда с `/images/`, e2e: загрузка
  картинки, адрес отдаёт её с правильным типом и `nosniff`; HTML не принимается.

## Тесты

- components: `node:test` — filesystem-хранилище (add/get/delete), метаданные
  (Redis, `TEST_REDIS_URL`), обработчики upload/download/delete через Express
  (тип по сигнатуре, 415, 413, ETag/304, nosniff), превью (sharp делает jpeg
  нужного размера); IPFS-хранилище — модульно с подменой клиента.
- ipfs-images: маршруты и авторизация (`partial`: `/ul` и `/del` закрыты,
  `/dl` открыт).
- mail-server: сборка клиента, e2e на стенде.
