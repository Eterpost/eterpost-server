import { requestBodyJsonSchema as addMailingBody } from './controllers/addMailing';
import { requestBodyJsonSchema as createRetryMailingBody } from './controllers/createRetryMailing';
import {
  requestBodyJsonSchema as requestSubscriptionBody
} from './controllers/requestSubscription';
import { requestBodyJsonSchema as previewDraftBody } from './controllers/previewDraft';
import { requestBodyJsonSchema as previewEmailBody } from './controllers/previewEmail';
import { requestBodyJsonSchema as restoreExcludedBody } from './controllers/restoreExcluded';
import { clickBodyJsonSchema, openBodyJsonSchema } from './controllers/tracking';
import { requestBodyJsonSchema as sendTestEmailBody } from './controllers/sendTestEmail';
import { requestBodyJsonSchema as subscribeBody } from './controllers/subscribe';
import { requestBodyJsonSchema as unsubscribeBody } from './controllers/unsubscribe';
import { requestBodyJsonSchema as unsubscribeFromAllBody } from './controllers/unsubscribeFromAll';
import { requestBodyJsonSchema as updateMailingBody } from './controllers/updateMailing';


// Описание API в формате OpenAPI 3.1. Схемы тел запросов берутся из контроллеров —
// те же, по которым проверяются запросы, поэтому описание не расходится с проверкой.
// Ответы описаны вручную; тест проверяет, что здесь есть каждый маршрут из routes.ts.

const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });

function body (schema: object, example?: object) {
  return {
    content: { 'application/json': { schema, ...(example ? { example } : {}) } },
    required: true
  };
}

function ok (data?: object, description = 'Успешно') {
  return {
    description,
    content: {
      'application/json': {
        schema: {
          type: 'object',
          properties: {
            success: { const: true },
            ...(data ? { data } : {})
          },
          required: ['success']
        }
      }
    }
  };
}

const failure = (description: string) => ({
  description,
  content: { 'application/json': { schema: ref('Error') } }
});

const badRequest = failure('Некорректный запрос: ошибка проверки тела или параметров');
const notFound = failure('Рассылка не найдена');

const mailingId = (name = 'id') => ({
  name,
  in: 'path',
  required: true,
  schema: { type: 'integer', minimum: 1 },
  description: 'ID рассылки'
});

const csvList = {
  limit: {
    name: 'limit',
    in: 'query',
    schema: { type: 'integer', minimum: 1 },
    description: 'Вернуть не больше указанного числа записей'
  },
  format: {
    name: 'format',
    in: 'query',
    schema: { enum: ['csv'] },
    description: 'csv — отдать файл CSV вместо JSON'
  }
};

const spaceHeader = { $ref: '#/components/parameters/Space' };
const spaceForbidden = failure('Нет доступа к пространству из X-Eterpost-Space (SPACE_FORBIDDEN)');

/**
 * Маршрутам рассылок — заголовок X-Eterpost-Space и ответ 403 на чужое пространство
 */
function withSpace<T extends Record<string, Record<string, any>>> (paths: T): T {
  for (const [path, item] of Object.entries(paths)) {
    if (!path.startsWith('/mailings')) {
      continue;
    }
    for (const operation of Object.values(item)) {
      operation.parameters = [...operation.parameters || [], spaceHeader];
      operation.responses = { 403: spaceForbidden, ...operation.responses };
    }
  }
  return paths;
}

const receiversList = (item: object) => ({
  type: 'object',
  properties: {
    list: { type: 'array', items: item },
    total: { type: 'integer' }
  }
});

function okOrCsv (data: object) {
  const response = ok(data);
  return {
    ...response,
    content: { ...response.content, 'text/csv': { schema: { type: 'string' } } }
  };
}

export const openApiDocument = {
  openapi: '3.1.0',
  info: {
    title: 'mail-server API',
    version: '0.1.0',
    description:
      'Сервис массовых рассылок. Ответ всегда JSON вида `{success, data}` при успехе ' +
      'или `{success: false, error, code?}` при ошибке.\n\n' +
      'Запросы — с ключом API: заголовок `Authorization: Bearer <ключ>` или ' +
      '`X-API-Key: <ключ>` (в этом окне — кнопка Authorize). Без ключа или с ' +
      'неизвестным ключом — 401; пока на сервере `server.auth.required` не включён, ' +
      'запросы без ключа пропускаются. Описание API (`/openapi.json`, `/docs/`) ' +
      'открыто без ключа.\n\n' +
      'Рассылки разделены по пространствам. Ключ пространства видит только своё; ' +
      'служебный ключ — все, а заголовком `X-Eterpost-Space` может выбрать одно. ' +
      'Рассылка чужого пространства — 404, как несуществующая.'
  },
  security: [{ bearerAuth: [] }, { apiKeyHeader: [] }],
  // Относительный адрес: запросы идут туда же, откуда загружен этот документ
  // (например, /api/ за nginx)
  servers: [{ url: '.' }],
  tags: [
    { name: 'mailings', description: 'Рассылки' },
    { name: 'receivers', description: 'Получатели рассылки' },
    { name: 'subscription', description: 'Подписка и отписка (используется subscription-facade)' },
    { name: 'mail-sorter', description: 'Используется mail-sorter' },
    {
      name: 'tracking',
      description: 'Отслеживание открытий и переходов (используется subscription-facade)'
    }
  ],
  paths: withSpace({
    '/mailings': {
      get: {
        tags: ['mailings'],
        summary: 'Список рассылок текущего пространства',
        parameters: [
          {
            name: 'kind',
            in: 'query',
            schema: { enum: ['live', 'test', 'all'], default: 'all' },
            description: 'live — только боевые, test — только пробные, all — все'
          }
        ],
        responses: {
          200: ok({ type: 'array', items: ref('MailingSummary') }),
          400: badRequest
        }
      },
      post: {
        tags: ['mailings'],
        summary: 'Создать рассылку или скопировать существующую',
        description:
          'Либо полное описание рассылки, либо `{sourceId}` — копия рассылки вместе ' +
          'с получателями. Адреса, отклонённые фильтром (некорректные, с постоянными ' +
          'ошибками доставки), возвращаются в `rejectedReceivers`. Рассылка (и копия) ' +
          'создаётся в текущем пространстве; если оно неясно (ключ прокси с несколькими ' +
          'пространствами без `X-Eterpost-Space`) — 403 `SPACE_REQUIRED`.',
        requestBody: body(addMailingBody, {
          name: 'Новости для партнёров',
          subject: 'Новости, {{receiver.name}}',
          html: '<p>Здравствуйте, {{receiver.name}}!</p>',
          from: 'Отдел продаж <sales@example.com>',
          replyTo: 'sales@example.com',
          receivers: [{ email: 'partner@example.com', name: 'Партнёр' }]
        }),
        responses: {
          200: ok({
            type: 'object',
            properties: {
              id: { type: 'integer' },
              listId: { type: 'string' },
              rejectedReceivers: { type: 'array', items: ref('ReceiverInput') }
            }
          }),
          400: badRequest,
          403: failure('Пространство не выбрано (SPACE_REQUIRED) или недоступно'),
          404: failure('Рассылка-источник не найдена')
        }
      }
    },
    '/mailings/unsubscribe': {
      post: {
        tags: ['mail-sorter'],
        summary: 'Исключить адрес из всех рассылок',
        description:
          'Без проверки кода. mail-sorter вызывает его для адресов с постоянными ' +
          'ошибками доставки и для запросов отписки, пришедших письмом. С ' +
          '`listUnsubscribe: true` адрес исключается только из рассылок с ' +
          'заголовком List-Unsubscribe (см. поле `listUnsubscribe` рассылки). ' +
          'С `mailingId` (номер из адреса отписки, подстановка `{id}` в ' +
          '`server.mail.listUnsubscribe`) адрес исключается только из рассылок ' +
          'пространства этой рассылки; без него или с несуществующим номером — из ' +
          'всех пространств. Только служебный ключ, иначе 403 (FORBIDDEN).',
        requestBody: body(unsubscribeFromAllBody, {
          email: 'reader@example.com', listUnsubscribe: true, mailingId: 7
        }),
        responses: {
          200: ok({
            type: 'object',
            properties: {
              removed: { type: 'integer', description: 'Из скольких рассылок удалён адрес' }
            }
          }),
          400: badRequest,
          403: failure('Ключ не служебный (FORBIDDEN)')
        }
      }
    },
    '/mailings/create-retry': {
      post: {
        tags: ['mailings'],
        summary: 'Создать повторную рассылку по адресам с ошибками доставки',
        description:
          'Адреса, исключённые mail-sorter (`excluded`), в неё не попадают. `filter` ' +
          'оставляет только нужные ошибки: отказы как спам, домены, временные или ' +
          'постоянные. С `dryRun: true` рассылка не создаётся, ответ — `{count}`, ' +
          'сколько адресов попадёт в повтор.',
        requestBody: body(createRetryMailingBody, {
          sourceId: 1, filter: { spam: true, domains: ['mail.ru', 'list.ru', 'bk.ru', 'inbox.ru'] }
        }),
        responses: {
          200: ok({
            type: 'object',
            properties: {
              count: { type: 'integer', description: 'Только при dryRun' },
              id: { type: 'integer' },
              listId: { type: 'string' }
            }
          }),
          400: badRequest,
          404: failure('Рассылка-источник не найдена')
        }
      }
    },
    '/mailings/{id}': {
      get: {
        tags: ['mailings'],
        summary: 'Рассылка',
        parameters: [
          mailingId(),
          {
            name: 'stringState',
            in: 'query',
            schema: { type: 'string' },
            description: 'Если задан, `state` возвращается названием (RUNNING), а не числом'
          }
        ],
        responses: {
          200: ok(ref('Mailing')),
          400: badRequest,
          404: notFound
        }
      },
      put: {
        tags: ['mailings'],
        summary: 'Изменить рассылку, её получателей или состояние',
        description:
          'Передаются только изменяемые поля. `receivers` заменяет список целиком. ' +
          'Смена `state` запускает (RUNNING), приостанавливает (PAUSED) или ' +
          'перезапускает рассылку; недопустимый переход — ошибка 400.',
        parameters: [mailingId()],
        requestBody: body(updateMailingBody, { state: 'RUNNING' }),
        responses: {
          200: ok({
            type: 'object',
            properties: {
              rejectedReceivers: { type: 'array', items: ref('ReceiverInput') }
            }
          }),
          400: badRequest,
          404: notFound
        }
      },
      delete: {
        tags: ['mailings'],
        summary: 'Удалить рассылку',
        description: 'Выполняющуюся рассылку удалить нельзя.',
        parameters: [mailingId()],
        responses: {
          200: ok(),
          400: badRequest,
          404: notFound
        }
      }
    },
    '/mailings/{id}/receivers': {
      get: {
        tags: ['receivers'],
        summary: 'Получатели рассылки',
        parameters: [mailingId(), csvList.limit, csvList.format],
        responses: {
          200: okOrCsv(receiversList(ref('Receiver'))),
          400: badRequest
        }
      }
    },
    '/mailings/{id}/results': {
      get: {
        tags: ['receivers'],
        summary: 'Результаты рассылки по получателям',
        description:
          'Строка на каждый адрес, включая тех, кого уже нет среди получателей ' +
          '(отписались, исключены): когда отправлено письмо, ошибка доставки, ' +
          'исключение, отписка (дата и способ: `link` — по ссылке, `mail` — письмом ' +
          'или кнопкой List-Unsubscribe), первое открытие и переход (у рассылок с ' +
          '`tracking`). `summary` — сколько адресов с каждым событием. Данные об ' +
          'отправке и отписках собираются с версии, где появился этот метод. ' +
          'CSV — со строкой заголовков: ' +
          '`email,name,sentAt,status,spam,diagnosticCode,failedAt,excluded,' +
          'unsubscribedAt,unsubscribeMethod,openedAt,clickedAt`.',
        parameters: [
          mailingId(),
          {
            name: 'event',
            in: 'query',
            schema: { enum: ['sent', 'failed', 'excluded', 'unsubscribed', 'opened', 'clicked'] },
            description: 'Только адреса с этим событием'
          },
          {
            name: 'offset',
            in: 'query',
            schema: { type: 'integer', minimum: 0 },
            description: 'Пропустить столько строк'
          },
          csvList.limit, csvList.format
        ],
        responses: {
          200: okOrCsv({
            type: 'object',
            properties: {
              list: { type: 'array', items: ref('ReceiverResult') },
              summary: {
                type: 'object',
                description: 'receivers — сколько сейчас в списке получателей, остальные ' +
                  'поля — сколько адресов с событием',
                properties: Object.fromEntries([
                  'receivers', 'sent', 'failed', 'excluded', 'unsubscribed', 'opened', 'clicked'
                ].map(name => [name, { type: 'integer' }]))
              },
              total: { type: 'integer', description: 'Строк с учётом event, без limit' }
            }
          }),
          400: badRequest,
          404: notFound
        }
      }
    },
    '/mailings/{id}/failed-receivers': {
      get: {
        tags: ['receivers'],
        summary: 'Получатели с ошибками доставки',
        description:
          'Адреса из списка получателей с ошибкой доставки после создания рассылки, ' +
          'а также адреса, которые mail-sorter уже исключил из рассылки ' +
          '(`excluded: true`, в CSV — четвёртая колонка `excluded`). ' +
          'Пятая и шестая колонки CSV — время ошибки (`date`) и номер рассылки, ' +
          'в которой она возникла (`mailingId`).',
        parameters: [mailingId(), csvList.limit, csvList.format],
        responses: {
          200: okOrCsv(receiversList(ref('FailedReceiver'))),
          400: badRequest,
          404: notFound
        }
      }
    },
    '/mailings/{id}/send-test-email': {
      post: {
        tags: ['mailings'],
        summary: 'Отправить тестовое письмо',
        parameters: [mailingId()],
        requestBody: body(sendTestEmailBody, { email: 'me@example.com' }),
        responses: {
          200: ok(),
          400: badRequest,
          404: notFound
        }
      }
    },
    '/mailings/{id}/preview': {
      post: {
        tags: ['mailings'],
        summary: 'Предпросмотр письма получателю без отправки',
        description:
          'Собирает письмо тем же кодом, что и отправка: шаблоны темы и HTML ' +
          'с данными получателя (имя, код, extraData, внешнее содержимое), ' +
          'текстовая версия из HTML, From/Sender/To и заголовки. Если адреса нет ' +
          'в рассылке, письмо собирается для получателя только с адресом, как ' +
          'тестовое (`receiverFound: false`).',
        parameters: [mailingId()],
        requestBody: body(previewEmailBody, { email: 'user@example.com' }),
        responses: {
          200: ok(ref('EmailPreview')),
          400: failure(
            'Ошибка проверки тела или шаблона (`TEMPLATE_ERROR`: поле и сообщение Handlebars)'
          ),
          404: notFound,
          502: failure('Не удалось получить внешнее содержимое (`EXTERNAL_CONTENT_ERROR`)')
        }
      }
    },
    '/preview': {
      post: {
        tags: ['mailings'],
        summary: 'Предпросмотр письма без созданной рассылки',
        description:
          'Собирает письма из переданных полей (те же, что при создании рассылки) ' +
          'для каждого получателя из `receivers` (до 100) тем же кодом, что и ' +
          'отправка; ничего не сохраняет и не отправляет. Ответ — массив писем в ' +
          'порядке `receivers`. Рассылки ещё нет, поэтому в `List-Id` вместо её ' +
          'номера стоит 0. У рассылки, открытой для подписки, получателям без ' +
          '`code` выдаётся случайный код, как при создании.',
        requestBody: body(previewDraftBody, {
          subject: 'Привет, {{receiver.name}}',
          html: '<p>Здравствуйте, {{receiver.name}}!</p>',
          receivers: [{ email: 'user@example.com', name: 'Иван' }]
        }),
        responses: {
          200: ok({ type: 'array', items: ref('EmailPreview') }),
          400: failure(
            'Ошибка проверки тела или шаблона (`TEMPLATE_ERROR`: поле и сообщение Handlebars)'
          ),
          502: failure('Не удалось получить внешнее содержимое (`EXTERNAL_CONTENT_ERROR`)')
        }
      }
    },
    '/mailings/{id}/restore-excluded': {
      post: {
        tags: ['receivers'],
        summary: 'Вернуть в рассылку адреса, исключённые из-за ошибок доставки',
        description:
          'Возвращает в конец списка получателей все исключённые адреса или только ' +
          '`emails`, с именем, кодом и `extraData` (у исключённых до появления этого ' +
          'метода — только адрес). Ошибки в статистике адреса сбрасываются, иначе ' +
          'его снова отбросило бы при создании рассылок. Завершённая рассылка ' +
          'ставится на паузу: продолжение отправит письма только возвращённым. ' +
          'Из других рассылок адрес остаётся исключённым.',
        parameters: [mailingId()],
        requestBody: body(restoreExcludedBody, { emails: ['user@example.com'] }),
        responses: {
          200: ok({
            type: 'object',
            properties: { restored: { type: 'array', items: { type: 'string' } } }
          }),
          400: badRequest,
          404: notFound
        }
      }
    },
    '/mailings/{mailingId}/requestSubscription': {
      post: {
        tags: ['subscription'],
        summary: 'Запросить подписку',
        description:
          'Отправляет письмо со ссылкой подтверждения. Рассылка должна быть открыта ' +
          'для подписки (`openForSubscription`). `schedule` (или устаревшее ' +
          '`periodicDate`) — расписание периодической отправки.',
        parameters: [mailingId('mailingId')],
        requestBody: body(requestSubscriptionBody, { email: 'user@example.com', name: 'Имя' }),
        responses: {
          200: ok(),
          400: failure(
            'Ошибка: CLOSED_FOR_SUBSCRIPTION, INVALID_SCHEDULE или ошибка проверки тела'
          ),
          404: notFound
        }
      }
    },
    '/mailings/{mailingId}/subscribe': {
      post: {
        tags: ['subscription'],
        summary: 'Подтвердить подписку кодом из письма',
        parameters: [mailingId('mailingId')],
        requestBody: body(subscribeBody),
        responses: {
          200: ok(textAfter('textAfterSubscribe')),
          400: failure('Нет запроса на подписку или код не совпадает'),
          404: notFound
        }
      }
    },
    '/mailings/{mailingId}/unsubscribe': {
      post: {
        tags: ['subscription'],
        summary: 'Отписаться по коду',
        description: 'Если адрес ещё не подписан, удаляется его запрос на подписку.',
        parameters: [mailingId('mailingId')],
        requestBody: body(unsubscribeBody),
        responses: {
          200: ok(textAfter('textAfterUnsubscribe')),
          400: failure('Адрес не подписан или код не совпадает'),
          404: notFound
        }
      }
    },
    '/tracking/open': {
      post: {
        tags: ['tracking'],
        summary: 'Открытие письма',
        description:
          'Вызывает subscription-facade, когда загружена картинка-счётчик из письма ' +
          '(`/t/o/<рассылка>/<токен>`). Отмечает первое открытие адреса; неизвестный ' +
          'токен — `recorded: false`.',
        requestBody: body(openBodyJsonSchema, { mailingId: 1, token: 'k3Jd9Q' }),
        responses: {
          200: ok({ type: 'object', properties: { recorded: { type: 'boolean' } } }),
          400: badRequest
        }
      }
    },
    '/tracking/click': {
      post: {
        tags: ['tracking'],
        summary: 'Переход по ссылке из письма',
        description:
          'Вызывает subscription-facade при переходе по `/t/c/<рассылка>/<токен>/<номер>`. ' +
          'Возвращает исходный адрес ссылки, отмечает переход и открытие.',
        requestBody: body(clickBodyJsonSchema, { mailingId: 1, token: 'k3Jd9Q', link: 0 }),
        responses: {
          200: ok({ type: 'object', properties: { url: { type: 'string' } } }),
          400: badRequest,
          404: failure('Неизвестный токен или номер ссылки')
        }
      }
    },
    '/sorter/status': {
      get: {
        tags: ['mail-sorter'],
        summary: 'Итог последнего запуска mail-sorter',
        description:
          'Записывает mail-sorter в Redis (ключ MAIL_SORTER_STATUS) в конце каждого ' +
          'запуска. `null` — mail-sorter ещё ни разу не запускался с этим Redis.',
        responses: {
          200: ok({ oneOf: [ref('SorterStatus'), { type: 'null' }] })
        }
      }
    },
    '/mailings/{mailingId}/receivers/{receiverId}': {
      delete: {
        tags: ['receivers'],
        summary: 'Удалить получателя из рассылки',
        description: 'Из выполняющейся рассылки удалить нельзя.',
        parameters: [
          mailingId('mailingId'),
          {
            name: 'receiverId',
            in: 'path',
            required: true,
            schema: { type: 'string' },
            description: 'Адрес получателя'
          }
        ],
        responses: {
          200: ok(),
          400: badRequest,
          404: failure('Рассылка или получатель не найдены')
        }
      }
    }
  }),
  components: {
    parameters: {
      Space: {
        name: 'X-Eterpost-Space',
        in: 'header',
        schema: { type: 'string', pattern: '^[a-z0-9][a-z0-9-]{0,31}$' },
        description: 'Текущее пространство рассылок. Ключу пространства не нужен; ' +
          'служебному необязателен (без него — все пространства)'
      }
    },
    securitySchemes: {
      bearerAuth: { type: 'http', scheme: 'bearer', description: 'Ключ API' },
      apiKeyHeader: { type: 'apiKey', in: 'header', name: 'X-API-Key' }
    },
    schemas: {
      Error: {
        type: 'object',
        properties: {
          success: { const: false },
          error: { type: 'string' },
          code: { type: 'string' }
        },
        required: ['success', 'error']
      },
      ReceiverResult: {
        type: 'object',
        properties: {
          email: { type: 'string' },
          name: { type: 'string' },
          sentAt: { type: 'string', format: 'date-time', description: 'Последняя отправка' },
          failure: {
            type: 'object',
            properties: {
              date: { type: 'string', format: 'date-time' },
              diagnosticCode: { type: 'string' },
              spam: { type: 'boolean' },
              status: { type: 'string' }
            }
          },
          excluded: { type: 'boolean', description: 'Исключён из-за ошибок доставки' },
          unsubscribed: {
            type: 'object',
            properties: {
              date: { type: 'string', format: 'date-time' },
              method: { enum: ['link', 'mail'] }
            }
          },
          openedAt: { type: 'string', format: 'date-time', description: 'Первое открытие' },
          clickedAt: { type: 'string', format: 'date-time', description: 'Первый переход' }
        },
        required: ['email']
      },
      EmailPreview: {
        type: 'object',
        properties: {
          from: { type: 'string', description: 'From: адрес рассылки или server.mail.from' },
          sender: {
            type: 'string',
            description: 'Sender: адрес сервиса, если у рассылки свой From'
          },
          replyTo: { type: 'string' },
          to: {
            type: 'array',
            items: {
              oneOf: [
                { type: 'string' },
                {
                  type: 'object',
                  properties: { address: { type: 'string' }, name: { type: 'string' } }
                }
              ]
            },
            description: 'To: адрес, с именем получателя, если оно есть'
          },
          headers: {
            type: 'object',
            additionalProperties: { type: 'string' },
            description: 'Дополнительные заголовки: List-Id, List-Unsubscribe, Precedence'
          },
          subject: { type: 'string' },
          html: { type: 'string' },
          text: { type: 'string', description: 'Текстовая версия, собранная из HTML' },
          receiver: {
            type: 'object',
            properties: { email: { type: 'string' }, name: { type: 'string' } }
          },
          receiverFound: {
            type: 'boolean',
            description: 'Есть ли адрес среди получателей рассылки'
          }
        }
      },
      MailingState: {
        type: 'integer',
        enum: [1, 2, 3, 4, 5],
        description: 'NEW = 1, RUNNING = 2, PAUSED = 3, FINISHED = 4, ERROR = 5'
      },
      MailingSummary: {
        type: 'object',
        properties: {
          id: { type: 'integer' },
          listId: { type: 'string' },
          name: { type: 'string' },
          openForSubscription: { type: 'boolean' },
          autoResumeAt: {
            type: 'string',
            format: 'date-time',
            description: 'Когда рассылка продолжится после автоматической паузы ' +
              '(maxEmailsWithoutPause, pauseDuration)'
          },
          pendingRetries: {
            type: 'integer',
            description: 'Сколько получателей ждут повтора после временного отказа ' +
              'на RCPT TO (4xx, server.rcptRetryDelays); пока они есть, рассылка выполняется'
          },
          nextRetryAt: {
            type: 'string',
            format: 'date-time',
            description: 'Когда ближайший такой повтор'
          },
          listUnsubscribe: {
            type: 'boolean',
            description: 'Добавлять заголовок List-Unsubscribe (server.mail.listUnsubscribe): ' +
              'по нему почтовые программы показывают кнопку «Отписаться». ' +
              'По умолчанию true'
          },
          tracking: {
            type: 'boolean',
            description: 'Отслеживать открытия и переходы по ссылкам (нужен ' +
              'server.tracking.url). По умолчанию false'
          },
          opened: {
            type: 'integer',
            description: 'Сколько адресов открыло письмо (только в GET /mailings/{id} при tracking)'
          },
          clicked: {
            type: 'integer',
            description: 'Сколько адресов перешло по ссылкам (там же)'
          },
          from: { type: 'string', description: 'Пусто — адрес сервиса (server.mail.from)' },
          replyTo: { type: 'string' },
          sentCount: { type: 'integer', description: 'Сколько писем отправлено' },
          space: { type: 'string', description: 'Пространство рассылки' },
          state: ref('MailingState'),
          test: { type: 'boolean', description: 'Пробная рассылка' },
          undeliveredCount: { type: 'integer' }
        }
      },
      Mailing: {
        allOf: [
          ref('MailingSummary'),
          {
            type: 'object',
            properties: {
              creationDate: { type: 'integer', description: 'Unix time, секунды' },
              extraData: { type: 'object' },
              html: { type: 'string', description: 'Шаблон Handlebars' },
              subject: { type: 'string', description: 'Шаблон Handlebars' }
            }
          }
        ]
      },
      ReceiverInput: {
        type: 'object',
        properties: {
          email: { type: 'string' },
          name: { type: 'string' },
          extraData: { type: 'object' }
        },
        required: ['email']
      },
      Receiver: {
        type: 'object',
        properties: {
          email: { type: 'string' },
          name: { type: 'string' },
          periodicDate: { type: ['string', 'integer'] }
        }
      },
      SorterStatus: {
        type: 'object',
        properties: {
          startedAt: { type: 'string', format: 'date-time' },
          finishedAt: { type: 'string', format: 'date-time' },
          success: { type: 'boolean' },
          error: { type: 'string', description: 'Почему запуск не удался' },
          readonly: {
            type: 'boolean',
            description: 'Пробный запуск: ничего не менялось'
          },
          mailboxes: { type: 'array', items: { type: 'string' } },
          lastSuccessAt: { type: ['string', 'null'], format: 'date-time' },
          stale: {
            type: 'boolean',
            description: 'Успешного запуска не было дольше server.sorterStatusMaxAge ' +
              '(по умолчанию 2 часа)'
          },
          types: {
            type: 'object',
            additionalProperties: { type: 'integer' },
            description: 'Число писем по типам: HUMAN, MAIL_SERVER, AUTORESPONDER, UNSUBSCRIBE'
          },
          actions: {
            type: 'object',
            additionalProperties: { type: 'integer' },
            description: 'Число выполненных действий по названиям'
          },
          counters: {
            type: 'object',
            properties: {
              actionsPerformed: { type: 'integer' },
              failed: { type: 'integer' },
              successful: { type: 'integer' }
            }
          },
          failedMessages: {
            type: 'array',
            items: { type: 'integer' },
            description: 'Номера писем, обработка которых не удалась (не больше 50)'
          }
        }
      },
      FailedReceiver: {
        type: 'object',
        properties: {
          email: { type: 'string' },
          status: { type: 'string', description: 'DSN status последней ошибки' },
          spam: { type: 'boolean' },
          diagnosticCode: { type: 'string' },
          date: { type: 'string', format: 'date-time', description: 'Когда записана ошибка' },
          mailingId: {
            type: 'integer',
            description: 'Рассылка, в которой возникла ошибка (нет у ошибок, ' +
              'записанных до 03.11.2026, и у писем без List-Id)'
          },
          excluded: {
            type: 'boolean',
            description: 'Адрес уже исключён из рассылки (mail-sorter)'
          }
        }
      }
    }
  }
};

function textAfter (field: string) {
  return {
    type: 'object',
    properties: {
      text: {
        type: ['string', 'null'],
        description: `Текст из extraData.${field} рассылки`
      }
    }
  };
}

export const swaggerUiHtml = `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>mail-server API</title>
  <link rel="icon" type="image/png" href="favicon-32x32.png">
  <link rel="stylesheet" href="swagger-ui.css">
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="swagger-ui-bundle.js"></script>
  <script src="init.js"></script>
</body>
</html>
`;

// Отдельным файлом, а не встроенным скриптом, — чтобы работало и при строгом CSP
export const swaggerUiInit = `window.ui = SwaggerUIBundle({
  url: '../openapi.json',
  dom_id: '#swagger-ui'
});
`;
