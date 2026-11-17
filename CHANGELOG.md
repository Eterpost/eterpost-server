# Changelog

All notable changes to eterpost-server. Versions follow [Semantic Versioning](https://semver.org/);
before 1.0 a minor version brings new features and a patch version brings fixes.

## 0.6.1 — 2026-11-17

### Internal
- The server is built as ES modules (`"type": "module"`); behaviour and API are the
  same. The webpack config is now `client/webpack.config.cjs`.

## 0.6.0 — 2026-11-17

### Receiver fields in the letter
- Web client: "Вставить поле" buttons above the letter text insert the receiver's
  name, address and the columns of the loaded receivers at the cursor, in the visual
  editor and in HTML; a column with spaces or signs becomes
  `{{receiver.extraData.[Дата продления]}}`.
- Under the editor, warnings about fields of the subject and text that will be
  empty: no such column (with a hint when only the letter case differs), empty for
  everyone, or empty for some receivers with an example address.
- API: `GET /mailings/:id/receiver-fields` — how many receivers have the name and
  each `extraData` column filled.

### Letter editor package
- The letter editor moved to a separate package,
  [eterpost-letter-editor](https://github.com/Eterpost/eterpost-letter-editor) 0.1.0,
  so other React interfaces can embed it; the web client uses it and looks the same.
- The "Светлый фон" choice is stored under a new key, so it resets once.
- The Docker image installs `git`: the package comes from a git tag.

## 0.5.0 — 2026-11-17

### Receivers from a file
- The receivers CSV file may have a header: `email`, `name` and any other columns,
  which go to `extraData` under their names — a file saved from Excel or LibreOffice
  works as is (`,` or `;`, UTF-8 or windows-1251). Files without a header are read
  in the old `email,name,JSON` format; JSON cut by unquoted commas is glued back.
- Errors in the file are shown with line numbers instead of silently doing nothing.

### Administration
- Web client: an "Администрирование" section for administrators with three tabs:
  all mailings of all spaces (filters, sorting, a summary of running mailings,
  opening a mailing in its space, moving it to another space), spaces (create,
  title and From, members, remove an empty one) and API keys (issue with the value
  shown once, change the role, revoke).
- API: `GET /me` and `/admin/*` routes for spaces, members, keys and moving mailings;
  only for logins from `server.auth.admins` through the front and keys with the new
  `admin` role (`apiKeysCli add|set-role <name> --admin`), others get 403
  `ADMIN_REQUIRED`. The key of the request cannot be changed or revoked, proxy keys
  are revoked only with `?force=1`.

## 0.4.0 — 2026-11-16

- Test email can be filled with the data of a mailing receiver: `send-test-email`
  takes an optional `receiver` address, the letter still goes only to `email`.
- Mailing card: the preview and test email fields are merged into a "Проверка письма"
  block with explicit fields (receiver data, own address), buttons and a hint
  describing what each button will do.

## 0.3.2 — 2026-11-11

- Plain text version of a letter: tables with `class="data-table"` are laid out in
  columns instead of one paragraph of glued cell texts (bug 20047).

## 0.3.1 — 2026-11-11

- deploy: `update.sh` and the Dockerfile build with `npm ci --omit=optional`, so npm
  packages with prebuilt binaries stay out of releases.
- deploy: image thumbnails use the ALT `node-sharp` package; `install.sh` installs it.

## 0.3.0 — 2026-11-11

### Letter images
- `client.imagePublicUrl`: the editor inserts the absolute public address of an image
  (ipfs-images) instead of a relative one, which did not open for receivers (bug 20032).
- Clear messages when an image is refused (not an image, too large).
- deploy: ipfs-images service, `/images/` in the web interface server and only
  `/images/dl/` on the public name; `update.sh ipfs-images`.

### Attachments
- Files can be attached to a mailing and go to every receiver as attachments of the
  letter, the test letter too (bug 20027).
- API: `POST/GET/DELETE /mailings/:id/attachments[/:attachmentId]`; `attachments`
  (base64) in `POST /mailings`; `attachments` and `attachmentsMaxSize` in a mailing;
  the preview lists attachments.
- Copies and retry mailings get copies of the files; deleting a mailing deletes them.
- Files are kept in `server.attachments.dir`; `server.attachments.maxSize` limits the
  total size of a letter (10 MB by default).
- The web client has an «Вложения» block in the mailing view.
- deploy: `StateDirectory=eterfund-mail` in `mail-server.service` and
  `server.attachments.dir` in the example config; the Docker image keeps files in
  `/app/data`.

### Fixes
- The retry form of the delivery errors tab no longer overlaps the test letter fields.
- An attachment sent as a form (`curl -F`) is refused with 415 instead of being stored
  with the form around it.
- `update.sh` starts an enabled service on its first deploy and skips a service whose
  unit is not installed.

## 0.2.0 — 2026-11-10

The first tagged release of Eterpost (Почтарь) under the Eterpost organization.

### Mailing spaces
- Mailings are divided into spaces. Lists, views, statistics and actions are limited to the
  space of a request; a mailing of another space answers 404.
- API keys get a role: a space key (sites and scripts), a system key (mail-sorter,
  subscription-facade) or a proxy key (the web front, users from `X-Remote-User`).
  Keys without a role keep full access and log a warning until a role is set.
- `X-Eterpost-Space` chooses the current space; `GET /spaces` lists the spaces of a request.
- Administrators (`server.auth.admins`) see every space.
- A space has its own From address; a mailing may still set its own.
- `spaces` CLI: add, set, list, members, add-member, remove-member, remove, move.
- `server.mail.listUnsubscribe` accepts `{id}`; unsubscribe by mail then only affects the
  space of that mailing (needs eterpost-sorter 0.3.0).
- Existing mailings move to the `default` space on the first start.

### Test mailings
- A mailing can be marked as a test one (`test`); `GET /mailings?kind=live|test|all`.
- The web client shows live mailings by default, with a «Боевые / Пробные / Все» filter.

### Letters
- Preview of a letter for a receiver, and of letters without a mailing (`POST /preview`),
  exactly as they will be sent: subject, HTML and the plain text part.
- Opens and clicks tracking for mailings with tracking turned on (through
  subscription-facade); results by receiver in the API and as CSV.
- A letter written as an HTML fragment is sent as a document for light and dark themes.
- The plain text part is generated from HTML; the receiver name goes into `To`.

### Delivery errors
- Retry a mailing for a part of its errors: spam rejections, domains, 4xx or 5xx.
- Put back receivers excluded for delivery errors.
- Delivery errors are counted from the mailing's own list.
- Receivers rejected with 4xx at RCPT TO are retried later.
- Rejections recognised as spam by a configurable set of patterns (`server.spamPatterns`).

### Operation
- API keys and `server.auth.required`.
- OpenAPI document and Swagger UI; the API version follows `package.json`.
- Mailings resume after a server restart.
- Deployment to an LXC container or VM on ALT Linux (`deploy/lxc`), releases with
  `update.sh`; release names include the version.
- Web client: light and dark themes, phone layout, mail-sorter status.

## 0.1.0

The original Etersoft mail-server (2018–2020), modernized for Node.js 22 in 2026.
