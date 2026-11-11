<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/brand/eterpost-logo-dark.svg">
  <img alt="Eterpost" src="docs/brand/eterpost-logo.svg" height="64">
</picture>

# eterpost-server

[Читать на русском](./README.ru.md)

Bulk mailing service: an HTTP API server on Node.js (mailings are stored in
[Redis](https://redis.io/), letters are sent over SMTP) and a web client on
React + Redux for creating and running mailings.

## Related projects

mail-server is the core of a small system. Two more projects work on top of it:

| Project | What it does |
|---|---|
| **mail-server** (this one) | Mailings and receivers, sending, statistics, subscription API, web client |
| [subscription-facade](https://github.com/Eterpost/eterpost-subscription-facade) | Public HTML pages for "subscribe" / "unsubscribe" links in letters; calls the mail-server API |
| [mail-sorter](https://github.com/Eterpost/eterpost-sorter) | Reads the `noreply@` mailbox over IMAP: bounces (DSN), unsubscribe requests, autoreplies, letters from people |

```
   operator                      people (links in letters)
      |                                    |
      v                                    v
  web client --/api--> mail-server <-- subscription-facade
                        |   |   ^
             mailings,  |   |   |  POST /mailings/unsubscribe
             statistics v   |   |
                     Redis  |  mail-sorter <--IMAP-- noreply@ mailbox
                       ^    |   |                          ^
                       |    | SMTP                         | bounces (DSN),
                       +----|---+ statistics               | replies
                            v                              |
                        receivers --------------------------+
```

How they fit together:

- **subscription-facade** needs only the mail-server URL (`backend` in its
  `config.json`). Links in letters point to it, see
  [Subscribe and unsubscribe](#subscribe-and-unsubscribe). It must be reachable
  from the internet; mail-server itself must not be.
- **mail-sorter** is started on schedule (e.g. hourly by cron) and reads the
  mailbox that receives replies to mailings, usually the address from
  `server.mail.from`. For the integration set in its `config.json`:
  - `redis` — the same Redis server, database and `prefixes` as mail-server:
    bounces are counted per mailing (by the `List-Id` header) and per address;
    the web client shows them as "delivery errors";
  - `database: { "type": "mail-server", "options": { "backend": "<mail-server URL>" } }` —
    addresses with permanent errors (or more than `maxTemporaryFailures`
    temporary ones) are removed from all mailings via `POST /mailings/unsubscribe`,
    senders of unsubscribe letters only from mailings with `listUnsubscribe`;
  - `forwardTo` — where to forward letters from people.

  mail-sorter writes the result of every run to Redis; the web client shows it
  under the mailing list ("Разбор ответов": last run, letters per type, excluded
  and unsubscribed addresses, errors) and warns when there was no successful run
  for `server.sorterStatusMaxAge` seconds (2 hours by default). API:
  `GET /sorter/status`.
- All three projects have a `Dockerfile`; the [test stand](#test-stand) runs
  them together.

## Quick start with Docker

```
$ docker build --target server -t mail-server .
$ docker build --target client -t mail-server-client .   # static client for nginx
$ docker run -d -v $PWD/config.json:/app/config.json -p 8000:8000 mail-server
```

The server reads `/app/config.json` on top of `config.default.json` and the
subscription letter template from `/app/templates/confirm-subscription.hbs`
(the example template is used if the file is not mounted). The client image is
nginx with the built client; proxy `/api/` to the server, e.g.:

```nginx
location /api/ { proxy_pass http://mail-server:8000/; }
location / { try_files $uri /index.html; }
```

### Test stand

[`stand/`](stand/README.md) runs all three projects in docker compose together
with Redis and a local mail server (GreenMail) and checks the whole chain:
sending, subscription through subscription-facade, bounce processing by
mail-sorter. subscription-facade and mail-sorter are built from their git
repositories by their own Dockerfiles; local copies can be used instead:

```
$ stand/run.sh
$ SUBSCRIPTION_FACADE_SRC=../../subscription-facade MAIL_SORTER_SRC=../../mail-sorter stand/run.sh
```

## Installation without Docker

Node.js 22.12 or newer and Redis are required.

```
$ npm ci
$ npm run server:build
$ cp templates/confirm-subscription.hbs.example templates/confirm-subscription.hbs
$ npm run server:start            # or: node server/dist/src/index.js
```

Client (optional):

```
$ npm run client:build            # the result is in client/public
```

Serve `client/public` with a web server and proxy `client.apiUrl` (`/api` by
default) to mail-server.

### Deployment without Docker

[`deploy/lxc/`](deploy/lxc/README.md) installs all three projects into an LXC
container or a VM with ALT Linux: systemd services, an hourly timer for
mail-sorter, nginx for the web client and the public subscription pages, local
Redis; mail goes out through the organisation's mail server
(`deploy/lxc/install.sh`; the guide is in Russian).

## Configuration

Create `config.json` in the project root; it is merged over
[`config.default.json`](config.default.json). The file is plain JSON (the
comments below are for explanation only):

```js
{
  "client": {
    "apiUrl": "/api",                  // where the client sends API requests
    "imageServiceUrl": "/images",      // image upload service for the editor (see below)
    "imagePublicUrl": "https://subscribe.example.com/images",  // public address of the same service: it goes into letters
    "staticUrl": "/",                  // <base href> of the client
    "webpack": { "port": 8080, "publicPath": "http://localhost:8080/" }  // dev server
  },
  "server": {
    "port": 8000,
    "host": "127.0.0.1",               // optional: listen address (all interfaces by default)
    "logLevel": "verbose",             // error, warn, info, verbose, debug
    "auth": { "required": true },      // API keys: false (default) lets requests without a key through and logs them
    "corsWhitelist": ["https://admin.example.com"],  // allowed origins for the API
    "fakeSender": false,               // true: print letters to the console instead of sending
    "mail": {
      "from": "noreply@example.com",   // service address: envelope sender (bounces) and default From
      "listIdDomain": "example.com",   // domain part of the List-Id header
      "listUnsubscribe": "<mailto:noreply+unsubscribe-{id}@example.com>"  // optional List-Unsubscribe header; {id} is the mailing number (add it only after updating mail-sorter, see "Mailing spaces")
    },
    "maxEmailsWithoutPause": 1000,     // optional: pause the mailing after this many letters...
    "pauseDuration": 600,              // ...for this many seconds (both must be set)
    "sendRetryDelays": [10, 60, 300],  // optional: pauses (s) before retrying a temporary SMTP error
    "rcptRetryDelays": [60, 300, 900, 3600],  // optional: pauses (s) before retrying a receiver rejected with 4xx at RCPT TO; [] — no retries
    "spamPatterns": ["\\bspam", "unsolicited"],  // optional: regular expressions for a server reply rejecting the letter as spam; a built-in set by default, as in mail-sorter
    "sorterStatusMaxAge": 7200,        // optional: warn if mail-sorter had no successful run for this long (s)
    "redis": {
      "host": "localhost",             // or "url": "redis://user:password@host:6379/0"
      "port": 6379,
      "db": 0,
      "password": "...",               // optional
      "pool": { "min": 1, "max": 5 },  // connection pool size
      "prefixes": {}                   // optional key prefixes, see RedisMailingRepository
    },
    "smtp": {                          // the organisation's mail server
      "host": "mail.example.com",
      "port": 587,
      "secure": false,                 // optional: true for TLS right away (port 465); otherwise STARTTLS
      "auth": { "user": "noreply@example.com", "pass": "%{SMTP_PASSWORD}" },  // optional
      "name": "mailing.example.com"    // optional: EHLO name, see below
    },
    "subscription": {
      "requestTTL": 1209600,           // lifetime of a subscription request, seconds
      "url": "https://subscribe.example.com",  // subscription-facade pages, for the confirmation link
      "subject": "Подписка на рассылку",  // subject of the confirmation letter
      "replyTo": "support@example.com" // optional
    },
    "attachments": {                   // mailing attachments, see «Attachments»
      "dir": "/var/lib/eterfund-mail/attachments",  // file directory; data/attachments in the working directory by default
      "maxSize": 10485760              // the largest total size of attachments of a letter, bytes (10 MB)
    },
    "tracking": {                      // optional: tracking of opens and clicks
      "url": "https://subscribe.example.com"  // public address of subscription-facade serving /t/...
    }
  }
}
```

`%{NAME}` in any string is replaced with the environment variable `NAME`
(startup fails if it is not set), so the SMTP password can be kept out of
`config.json`. The EHLO name defaults to the system host name if it is a full
domain name, otherwise nodemailer sends `[127.0.0.1]`, which some relays and
spam filters penalise: set `smtp.name` then.

`client.*` values are built into the client, so rebuild it after changing them.
`client.imageServiceUrl` is a service for images inserted in the editor
(`POST <url>/ul` with a file returns `{"id": ...}`, the image is then available
at `<url>/dl/<id>/<name>`), for example
[ipfs-images](https://github.com/Eterpost/ipfs-images). A letter gets the address
`client.imagePublicUrl/dl/<id>/<name>`: it must be absolute and open from outside
(for the receiver of the letter). Without `imagePublicUrl` the `imageServiceUrl`
address is inserted, and a relative address does not open for the receiver.

## Mailings

A mailing has a name, subject, HTML text, optional From and Reply-To, a list of receivers
and a state: NEW = 1, RUNNING = 2, PAUSED = 3, FINISHED = 4, ERROR = 5. A running
mailing can be paused and continued; a finished one can be restarted from the
beginning. Mailings that were running when the server stopped continue on the
next start; a mailing paused automatically (`maxEmailsWithoutPause`) continues
at the saved time (`autoResumeAt`), even after a restart.

Every mailing gets a unique `List-Id` header
`<YYYYMMDD-<id>.eterpost.<listIdDomain>>` (RFC 2919); letters also have
`Precedence: bulk`. mail-sorter uses `List-Id` to attribute bounces to a
mailing. Mailings created earlier keep the old form
`<YYYYMMDD-<id>@<listIdDomain>>`; mail-sorter understands the new form since
"Read List-Id from the raw header".

The `List-Unsubscribe` header (`server.mail.listUnsubscribe`) is added only to
mailings with `listUnsubscribe: true` (on by default; it can be turned off for a
mailing). Mail programs show an "Unsubscribe"
button by this header. A letter sent to its address unsubscribes the sender only
from mailings with this option, not from the rest.

Letters are sent as HTML with a plain text alternative generated from it
(images are dropped, links become `text [url]`). Tables with
`class="data-table"` are laid out in columns there; other tables (e.g. the
letter layout) become paragraphs.

A mailing may set its own `From` (e.g. `Sales <sales@example.com>`). The
envelope sender (Return-Path) and the `Sender` header stay `server.mail.from`,
so bounces still reach the mailbox read by mail-sorter. The `From` domain needs
SPF and DKIM records that allow the mail relay to send for it.

Receivers are added in the web client from a CSV file without a header, one
receiver per line: `email,name,extraData`, where `extraData` is an optional JSON
object, e.g. `ivan@example.com,Ivan,{"city": "Moscow"}`. Invalid addresses and
addresses whose last delivery status was a permanent error (5.x.x) are rejected
when a mailing is created. A rejection as spam is the exception: the letter was
refused because of its content or the sender (spam, blocklists, reputation,
SPF/DKIM/DMARC), not the address, so the address stays. This is detected from
the server reply (`server.spamPatterns`) both when sending and in mail-sorter
from DSNs.

### Letter templates

Subject and HTML text are [Handlebars](https://handlebarsjs.com/) templates
rendered for every receiver with the context:

- `receiver.email`, `receiver.name`, `receiver.code` (personal code for
  subscribe/unsubscribe links), `receiver.extraData.*`;
- `mailing.id`, `mailing.name`, `mailing.listId`, `mailing.extraData.*`.

Two helpers insert content from other services:

- `{{external_content "https://example.com/news.html"}}` — GET the URL once per
  mailing run and insert the response;
- `{{external_content_with_receiver_data "https://example.com/personal"}}` — POST
  `receiver.extraData` as JSON for every receiver and insert the response.

If a request fails, the letter is not sent and the mailing goes to the ERROR state.

### Preview and test letter

You can check how a receiver will see the letter without running the mailing:

- **Preview** — the "Предпросмотр для" field and the "Показать" button in the
  mailing card, `POST /mailings/:id/preview` with `{email}` in the API. The
  server builds the letter with the same code as for sending and returns the
  subject, HTML, plain text version, From/Sender/To/Reply-To and headers
  (`List-Id`, `List-Unsubscribe`, `Precedence`); nothing is sent. If the address
  is among the receivers, their name, code and `extraData` are used and external
  content is fetched; otherwise the letter is built with the address only
  (`receiverFound: false`).
- **Preview without a mailing** — `POST /preview`: the same fields as for
  creating a mailing (`subject`, `html`, `from`, `replyTo`, `listUnsubscribe`,
  `openForSubscription`, `extraData`, `name`) and `receivers`, up to 100
  receivers `{email, name?, code?, extraData?}`. The answer is an array of
  letters in the same form, one per receiver; nothing is saved. A program that
  prepares a mailing on its side can check the letter before creating it.
  `List-Id` has 0 instead of the mailing number.
- **Test letter** — the "Пробное письмо на адрес" field,
  `POST /mailings/:id/send-test-email` with `{email}` in the API: the letter is
  really sent to that address, to a receiver with the address only.

If the subject or HTML template does not compile, the preview answers 400
with the `TEMPLATE_ERROR` code and a text like `html: Parse error on line 3: ...`;
if external content cannot be fetched, it answers 502 (`EXTERNAL_CONTENT_ERROR`).

The preview of a mailing and the test letter use the saved mailing: unsaved
changes in the editor are not included.
Other programs (admin panels and so on) should not render the letter with their
own copy of Handlebars: the service builds the plain text version and headers
itself, and a copy may differ from it — use the preview to show the letter.

### Attachments

Files (a price list in PDF, for example) can be attached to a mailing: every
receiver gets them as ordinary attachments of the letter, the test letter too.
The mailing view has an «Вложения» block (add, download, delete); in the API:

- `POST /mailings/:id/attachments?filename=<name>` — the request body is the file;
  the type comes from Content-Type, or from the file extension for
  `application/octet-stream`. The 201 answer is `{id, filename, contentType, size}`.
  A form (`curl -F`) is refused (415): send the file as the body, for example
  `curl --data-binary @price.pdf -H 'Content-Type: application/pdf' \
  '<api>/mailings/5/attachments?filename=price.pdf'`;
- `GET /mailings/:id/attachments/:attachmentId` — download the file;
- `DELETE /mailings/:id/attachments/:attachmentId` — delete it;
- `POST /mailings` with `attachments: [{filename, contentType?, content}]`
  (`content` in base64) creates a mailing with attachments at once;
- `GET /mailings/:id` returns `attachments` and `attachmentsMaxSize`; a preview
  lists attachments without their content.

A copy of a mailing and a retry of failed receivers get copies of the files;
deleting a mailing deletes its files. The total size of attachments of a letter is
limited by `server.attachments.maxSize` (10 MB by default; base64 makes a letter
about a third larger) — over it the answer is 413 (`ATTACHMENTS_TOO_LARGE`).
Attachments of a running mailing cannot be changed (409, `MAILING_RUNNING`).

Files are kept on disk in `server.attachments.dir` (`<dir>/<mailing id>/<id>`),
Redis keeps only their descriptions; back the directory up together with Redis.
If the directory cannot be created, the server logs an error and the attachment
routes answer 503 (`ATTACHMENTS_UNAVAILABLE`); mailings without attachments keep
working. If an attachment file disappears from disk, neither the mailing nor a test
letter goes out without it: a start and a test letter answer 409
(`MISSING_ATTACHMENT`) with the file name, and a mailing resumed after a restart
goes to ERROR.

### Mailing results

`GET /mailings/:id/results` ("Скачать результаты" in the web client, CSV) gives
for every address, including those no longer among the receivers: when the
letter was sent (`sentAt`), the delivery error (`failure`), exclusion for
errors (`excluded`), unsubscription with its date and way
(`unsubscribed.method`: `link` — by the link, `mail` — by a letter or the
List-Unsubscribe button), the first open and click (`openedAt`, `clickedAt`,
with tracking on). `summary` has the number of addresses with each event.
`?event=sent|failed|excluded|unsubscribed|opened|clicked` keeps only the
addresses with that event, `?offset=` and `?limit=` page the list. Sending and
unsubscriptions are recorded starting from this version.

### Tracking of opens and clicks

Off by default. It is turned on for a mailing with the "Отслеживать открытия и
переходы по ссылкам" checkbox (`tracking: true` in the API); the server needs
`server.tracking.url`, the public address of subscription-facade.

When sending, every letter gets a random token. Links http(s) in the HTML go
through `<tracking.url>/t/c/<mailing>/<token>/<number>`, and the image
`<tracking.url>/t/o/<mailing>/<token>` is added at the end of the letter.
subscription-facade reports the event to mail-server (`POST /tracking/open`,
`/tracking/click`) and serves the image or redirects to the original link,
whose address is kept on the server, so the service cannot be used to redirect
to an arbitrary address. Links to subscription-facade pages (subscribe,
unsubscribe) and `mailto:` are not wrapped, and the plain text version keeps
the original links. The preview and the test letter are built without
tracking: links in them lead straight to the target.

The mailing card shows how many addresses opened the letter and clicked a link
(`opened`, `clicked` in `GET /mailings/:id`).

The data is approximate: many mail programs do not load images or load them in
advance through their proxy (Gmail, Apple Mail), and a link may be followed by
an antivirus. Opens and clicks are personal data of the receivers: mention the
tracking in the mailing text or the privacy policy.

### Periodic receivers

Receivers who subscribed with a schedule (`periodicDate`) get the letter only on
matching days when the mailing is started: a day of month (`15`; the last day of
a shorter month is used for `31`) or a cron expression for day of month, month
and day of week (`* * 1` — on Mondays). Receivers without a schedule get every
mailing.

### Failed receivers and retry

"Delivery errors" in the web client lists receivers whose letters from this
mailing were not delivered (`GET /mailings/:id/failed-receivers`, also as CSV). Each mailing has its own
list of errors: mail-sorter attributes a DSN to a mailing by `List-Id`, and
mail-server records rejections while sending. For addresses without an entry
there (a DSN without `List-Id`, errors from before the list appeared) the last
delivery status of the address is used if it was recorded after the mailing
was created and does not belong to another mailing. Addresses that mail-sorter
has already removed from the mailing for delivery errors stay in this list
marked as excluded (`excluded: true`, the fourth CSV column). Each error has
its time (`date`, the fifth CSV column) and the mailing it came from
(`mailingId`, the sixth column; unknown for errors recorded before this field
appeared). "Retry" creates a new mailing with the same text for these
addresses, except the excluded ones. In the "Ошибки доставки" tab a retry can
take only part of the errors: rejections as spam, addresses from the chosen
domains (e.g. mail.ru, list.ru, bk.ru, inbox.ru after a block is lifted), only
temporary or only permanent errors; the number of addresses is shown at once.
In the API this is `filter: {spam, domains, status: "4" | "5"}` of
`POST /mailings/create-retry`, and `dryRun: true` only counts the addresses.

An address excluded by mistake (the mailbox works again, the person confirmed
the address) can be put back: the ↺ button at the address or "Вернуть
исключённых" for all of them, `POST /mailings/:id/restore-excluded` with
`{emails}` in the API (all of them without the field). The address goes back to
the end of the receiver list with its name, code and `extraData`, and the errors
in its statistics are cleared, otherwise it would be dropped again when a
mailing is created. A finished mailing is paused: "Continue" sends letters only
to the restored addresses. In other mailings the address stays excluded.

SMTP errors while sending: a receiver rejected at `RCPT TO` gets a delivery
status in its statistics and the mailing goes on with the next receiver. Many
relays check the address right away and reject it there, so no bounce (DSN)
reaches mail-sorter. A 5xx rejection is a permanent error (the address appears
among delivery errors and is filtered out of new mailings). A 4xx one (address
verification in progress, greylisting) puts the receiver into a retry list:
after the main pass the letter is sent to it again after the `rcptRetryDelays`
pauses (by default 1, 5, 15 and 60 minutes). The mailing stays running until
the list is empty; the list survives a pause and a restart, and the mailing
shows how many receivers wait (`pendingRetries`, `nextRetryAt`). A 5xx on retry
is a permanent error; a 4xx after the last retry is a temporary failure
(`temporaryFailureCount`, as mail-sorter counts it). Other
temporary errors (4xx at `MAIL FROM` or `DATA`, connection failures) are
retried after the `sendRetryDelays` pauses. Any other error (e.g. the letter
rejected at `DATA`) or retries exhausted put the mailing into ERROR; started
again, it continues with the same receiver.

## Subscribe and unsubscribe

Personal codes are assigned to all receivers when a mailing is created with
"open for subscription" (`openForSubscription`) or it is switched on later
(`PUT /mailings/:id`), to receivers added later while it is on, and to everyone who subscribed through the
API. The subscription flow with subscription-facade:

1. A site calls `POST /mailings/:id/requestSubscription` with
   `{"email", "name", "periodicDate" | "schedule", "extraData"}`.
2. mail-server sends a confirmation letter from
   `templates/confirm-subscription.hbs` (context: `confirmUrl`, `subscribeUrl`,
   `mailing`, `subscriptionRequest.email`, `subscriptionRequest.code`, `name`,
   `alreadySubscribed`). The link in it, `{{confirmUrl}}`, points to
   subscription-facade: `<server.subscription.url>/subscribe?code=...&email=...&mailingId=...`
   with the address URL-encoded. Without `server.subscription.url` the server
   logs an error at startup and `confirmUrl` is empty.
3. subscription-facade calls `POST /mailings/:id/subscribe` and shows the result.

An unsubscribe link in the mailing text:

```html
<a href="https://subscribe.example.com/unsubscribe?mailingId={{mailing.id}}&email={{receiver.email}}&code={{receiver.code}}">Unsubscribe</a>
```

`mailing.extraData.textAfterSubscribe` and `textAfterUnsubscribe` (HTML) replace
the default texts on the subscription-facade pages.

## API

All responses are JSON `{"success": true, "data": ...}` or
`{"success": false, "error": "...", "code": "..."}`. Request bodies are JSON.

The service describes itself: the OpenAPI 3.1 document is served at
`GET /openapi.json` and interactive Swagger UI at `/docs/` (behind the nginx
from the examples: `/api/openapi.json` and `/api/docs/`). Request body schemas
there are the same ones the server validates requests with; a test checks that
every route is documented.

| Method and path | Description |
|---|---|
| `GET /mailings` | List of mailings of the current space, `?kind=live\|test\|all` (default `all`) |
| `GET /spaces` | Spaces available to the request: `[{name, title, from}]` |
| `GET /mailings/:id` | Mailing with text and statistics (`?stringState=1` — state as a name) |
| `POST /mailings` | Create: `{name, subject, html, receivers: [{email, name?, extraData?}], from?, replyTo?, openForSubscription?, test?, extraData?}` (into the space of `X-Eterpost-Space`) or clone: `{sourceId}` |
| `PUT /mailings/:id` | Change fields, `receivers`, or `state` (`2`/`"running"` — start, `3`/`"paused"` — pause) |
| `DELETE /mailings/:id` | Delete (not while running) |
| `GET /mailings/:id/receivers` | Receivers, `?limit=N`, `?format=csv` |
| `DELETE /mailings/:id/receivers/:email` | Remove a receiver |
| `GET /mailings/:id/failed-receivers` | Receivers with delivery errors, `?limit=N`, `?format=csv` |
| `GET /mailings/:id/results` | Results by receiver: sending, error, exclusion, unsubscription, open, click; `?event=`, `?offset=`, `?limit=`, `?format=csv` |
| `POST /mailings/:id/restore-excluded` | Put back addresses excluded for delivery errors `{emails?}`, returns `{restored}` |
| `POST /mailings/:id/send-test-email` | Send the letter to `{email}` |
| `POST /mailings/:id/preview` | Build the letter for receiver `{email}` without sending it: subject, HTML, plain text and headers as the service sends them |
| `POST /preview` | The same without a mailing: from mailing fields and `receivers` (up to 100), returns an array of letters |
| `POST /mailings/create-retry` | New mailing for failed receivers of `{sourceId}` |
| `POST /mailings/:id/requestSubscription` | Subscription request, see above |
| `POST /mailings/:id/subscribe` | Confirm subscription `{email, code}` |
| `POST /mailings/:id/unsubscribe` | Unsubscribe `{email, code}` |
| `POST /mailings/unsubscribe` | System and legacy keys only. Remove `{email}` from all mailings without a code (for mail-sorter); with `mailingId` only from mailings of its space; with `listUnsubscribe: true` only from mailings with this option; returns `{removed}` |

### API keys

A request passes its key in `Authorization: Bearer <key>` (or
`X-API-Key: <key>`). Every key has a name that tells who uses it (`front`,
`subscription-facade`, `site-example`…); the server keeps only its sha256 in
Redis, and the key itself is printed once, when it is created. An unknown key
always gets `401`. With `server.auth.required: false` (the default) a request
without a key is let through, and the server logs `Request without API key: …`
once per 10 minutes per address and route — this way you find everyone who
still needs a key before switching to `true`; with `true` such a request gets
`401`. Only `/openapi.json` and `/docs/` are always open.

Keys are managed on the server (it needs the Redis from the config; if the
config has `%{NAME}`, pass the same environment variables):

```
node server/dist/src/apiKeysCli.js add site-example      # print a new key
node server/dist/src/apiKeysCli.js add front --proxy     # a reverse proxy key
node server/dist/src/apiKeysCli.js list                  # name, type, created, last used
node server/dist/src/apiKeysCli.js revoke site-example
```

A `--proxy` key is for the front through which people use the web client: the
front authenticates the user and adds its key and an `X-Remote-User` header
with the user name. The server trusts this header only together with a proxy
key. Changing requests (everything but `GET`) are logged with the key and user
names and the list of body fields (without the letter text and addresses):
`PUT /mailings/5 by ivan via front from 10.0.0.7: state=running`.
subscription-facade (`apiKey` in its config) and mail-sorter (`apiKey` in the
`mail-server` driver options) need keys of their own.

### Mailing spaces

Mailings are divided into spaces (name `[a-z0-9][a-z0-9-]{0,31}`, a title, an
optional default From address and a list of members, the logins that the front
passes in `X-Remote-User`). A mailing, its statistics and all actions on it are
available only inside its space; a mailing of another space answers `404`, as
if it did not exist. Mailings created before spaces appeared are moved to the
space `default` on the first start (the log tells how many).

Roles of API keys (`api-keys add <name> --space <space> | --system | --proxy`,
`api-keys set-role <name> …` changes the role of an existing key):

| Role | For | Sees |
|---|---|---|
| `--space sales` | sites and scripts of a sender | only mailings of its space |
| `--system` | mail-sorter, subscription-facade | all mailings; needed for unsubscription, subscription, counters and bounces |
| `--proxy` | the front of the web client | spaces of the user from `X-Remote-User` (all spaces for logins in `server.auth.admins`) |
| none (legacy) | keys created before spaces | all mailings, as before; logged as a warning `has no role` (at most once per 10 minutes per key) |

Until some space has members, the user of a proxy key sees `default` (also a request
without `X-Remote-User`), so the web client does not become empty after the
upgrade.

Isolation is enforced only when `server.auth.required: true` and no legacy keys
remain: a request without a key and a legacy key see all spaces.

The current space of a request is set by the `X-Eterpost-Space` header (the web
client sends it). A space key does not need it; for a system key it is optional
(without it, all spaces); a space the request has no access to gives `403`
(`SPACE_FORBIDDEN`), a missing header where the space is required gives `403`
(`SPACE_REQUIRED`). `POST /mailings` and `POST /mailings/create-retry` write
the mailing to the current space. `GET /spaces` lists the spaces available to
the request (name, title, From).

Test mailings: the mailing field `test: boolean` (default `false`) marks a
trial mailing. `GET /mailings?kind=live|test|all` filters the list inside the
space; the API default is `all`, the web client shows `live` and keeps the
choice in the page address. Delivery errors of test mailings count in the
address statistics like any other.

Sender address: the From of a letter is taken from the mailing (`from`), then
from the space, then from `server.mail.from`. Sender and the envelope are
always `server.mail.from`: bounces are processed by mail-sorter.

Unsubscription by letter works inside the space of the mailing: put `{id}` in
`server.mail.listUnsubscribe`, e.g. `<mailto:noreply+unsubscribe-{id}@example.com>`;
mail-sorter takes the number from the address and passes it as `mailingId` to
`POST /mailings/unsubscribe`, and the address is removed from the mailings of
that space only. Without `{id}` (and in older letters) the address is removed
from all spaces, as before. `POST /mailings/unsubscribe` is allowed only to
system and legacy keys. Update mail-sorter first and add `{id}` afterwards: the
old mail-sorter recognises only the exact `+unsubscribe` and silently ignores
letters with a number (order: [deploy/lxc/README.md](deploy/lxc/README.md#переход-на-пространства-рассылок)).

Spaces are managed on the server, like keys:

```
node server/dist/src/spacesCli.js add default --title "Common"   # first: holds the existing mailings
node server/dist/src/spacesCli.js add sales --title "Sales" --from "Sales <sales@example.com>"
node server/dist/src/spacesCli.js set sales --from "Sales <sales@example.com>"
node server/dist/src/spacesCli.js list                      # name, title, From, members
node server/dist/src/spacesCli.js members sales
node server/dist/src/spacesCli.js add-member sales ivan
node server/dist/src/spacesCli.js remove-member sales ivan
node server/dist/src/spacesCli.js move 7 sales             # move mailing #7 to the space "sales" (also back to default)
node server/dist/src/spacesCli.js remove sales              # refused while it has mailings; members are deleted with it
```

Upgrading a running installation is described in
[deploy/lxc/README.md](deploy/lxc/README.md#переход-на-пространства-рассылок).
Note: a non-numeric mailing id in `/mailings/:id/...` (including subscribe and
unsubscribe) now answers `400 Invalid ID`.

## Development

```
$ npm run typecheck && npm run lint
$ npm test                        # build and run server tests (node:test)
$ npm run server:watch-run        # with npm run server:watch in another terminal
$ npm run client:watch            # webpack dev server for the client
```

Tests that need Redis run only when `TEST_REDIS_URL` is set. **That database is
flushed**, so use a separate Redis instance:

```
$ docker run -d --name test-redis -p 127.0.0.1:16379:6379 redis:7-alpine
$ TEST_REDIS_URL=redis://127.0.0.1:16379/1 npm test
```

## Bugs and feature requests

Report bugs and feature requests in the Etersoft Bugzilla: product Eterpost,
component eterpost-server — [file a bug](https://bugs.etersoft.ru/enter_bug.cgi?product=Eterpost&component=eterpost-server).

## ![AGPL](https://www.gnu.org/graphics/agplv3-88x31.png) License

GNU AGPL v3, see [LICENSE](LICENSE).
