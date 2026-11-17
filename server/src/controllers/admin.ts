import { Express, NextFunction, Request, Response } from 'express';
import { error, success } from '../utils/response.js';
import { catchPromise } from '../utils/catchPromise.js';
import { jsonSchemaMiddleware } from '../middleware/jsonSchemaMiddleware.js';
import { describeActor, getActor } from '../middleware/apiKeyAuth.js';
import { getSpaceAccess } from '../middleware/spaceAccess.js';
import {
  API_KEY_NAME_PATTERN, ApiKeyRecord, ApiKeyRepository, ApiKeyRole, describeRole
} from '../ApiKeyRepository.js';
import { DEFAULT_SPACE, SPACE_NAME_PATTERN, SpaceRepository } from '../SpaceRepository.js';
import { MailingRepository } from '../MailingRepository.js';
import { Logger } from '../Logger.js';


/**
 * Роль ключа в API админки. Legacy (без роли) назначить нельзя — только увидеть
 */
export type ApiRole =
  { type: 'admin' } | { type: 'legacy' } | { type: 'proxy' } |
  { type: 'space', space: string } | { type: 'system' };

export function toApiRole (record: ApiKeyRole): ApiRole {
  if (record.space) {
    return { space: record.space, type: 'space' };
  }
  if (record.system) {
    return { type: 'system' };
  }
  if (record.admin) {
    return { type: 'admin' };
  }
  return { type: record.proxy ? 'proxy' : 'legacy' };
}

function fromApiRole (role: ApiRole): ApiKeyRole {
  switch (role.type) {
    case 'admin': return { admin: true };
    case 'proxy': return { proxy: true };
    case 'space': return { space: role.space };
    case 'system': return { system: true };
    default: throw new Error('Unknown role');
  }
}

// Логин участника: то, что фронт передаёт в X-Remote-User
const LOGIN_PATTERN = /^[^\s/]{1,64}$/;

const roleSchema = {
  oneOf: [
    {
      additionalProperties: false,
      properties: { type: { enum: ['admin', 'proxy', 'system'] } },
      required: ['type'],
      type: 'object'
    },
    {
      additionalProperties: false,
      properties: {
        space: { pattern: SPACE_NAME_PATTERN.source, type: 'string' },
        type: { const: 'space' }
      },
      required: ['type', 'space'],
      type: 'object'
    }
  ]
};

const spaceFields = {
  from: { maxLength: 256, type: 'string' },
  title: { maxLength: 128, type: 'string' }
};

export const createSpaceBody = {
  additionalProperties: false,
  properties: { name: { pattern: SPACE_NAME_PATTERN.source, type: 'string' }, ...spaceFields },
  required: ['name'],
  type: 'object'
};

export const updateSpaceBody = {
  additionalProperties: false,
  minProperties: 1,
  properties: spaceFields,
  type: 'object'
};

export const createKeyBody = {
  additionalProperties: false,
  properties: { name: { pattern: API_KEY_NAME_PATTERN.source, type: 'string' }, role: roleSchema },
  required: ['name', 'role'],
  type: 'object'
};

export const setKeyRoleBody = {
  additionalProperties: false,
  properties: { role: roleSchema },
  required: ['role'],
  type: 'object'
};

export const moveMailingBody = {
  additionalProperties: false,
  properties: { space: { pattern: SPACE_NAME_PATTERN.source, type: 'string' } },
  required: ['space'],
  type: 'object'
};

/**
 * Кто сделал запрос и админ ли он: по этому веб-клиент решает, показывать ли
 * раздел «Администрирование»
 */
export function getMe () {
  return function (req: Request, res: Response) {
    const actor = getActor(res);
    res.json(success({
      admin: Boolean(getSpaceAccess(res).admin),
      key: actor.key,
      user: actor.user
    }));
  };
}

/**
 * Только для админа: ключ с ролью admin или логин из server.auth.admins через фронт
 */
export function requireAdmin (req: Request, res: Response, next: NextFunction) {
  if (!getSpaceAccess(res).admin) {
    res.status(403).json(error('Administrator access required', 'ADMIN_REQUIRED'));
    return;
  }
  next();
}

/**
 * Маршруты /admin: пространства, участники, ключи API, перенос рассылок.
 * Каждый — только для админа (requireAdmin)
 */
export function setupAdminRoutes (
  app: Express, spaces: SpaceRepository, keys: ApiKeyRepository, mailings: MailingRepository,
  logger: Logger
): void {

  function log (res: Response, message: string) {
    logger.info(`admin: ${message} by ${describeActor(getActor(res))}`);
  }

  async function spaceExists (name: string) {
    return name === DEFAULT_SPACE || Boolean(await spaces.get(name));
  }

  async function countMailings (): Promise<Map<string, number>> {
    const counts = new Map<string, number>();
    for (const mailing of await mailings.getAll()) {
      const space = mailing.space || DEFAULT_SPACE;
      counts.set(space, (counts.get(space) || 0) + 1);
    }
    return counts;
  }

  app.get('/admin/spaces', requireAdmin, catchPromise(async (req, res) => {
    const stored = await spaces.list();
    if (!stored.some(space => space.name === DEFAULT_SPACE)) {
      stored.push({ createdAt: '', name: DEFAULT_SPACE });
      stored.sort((a, b) => a.name.localeCompare(b.name));
    }
    const counts = await countMailings();
    res.json(success(await Promise.all(stored.map(async space => ({
      createdAt: space.createdAt || undefined,
      from: space.from,
      mailingCount: counts.get(space.name) || 0,
      members: await spaces.getMembers(space.name),
      name: space.name,
      title: space.title
    })))));
  }));

  app.post('/admin/spaces', requireAdmin, jsonSchemaMiddleware(createSpaceBody),
    catchPromise(async (req, res) => {
    const { from, name, title } = req.body;
    if (!await spaces.add({ from: from || undefined, name, title: title || undefined })) {
      res.status(409).json(error(`Space "${name}" already exists`, 'SPACE_EXISTS'));
      return;
    }
    log(res, `space "${name}" created`);
    res.json(success());
  }));

  app.put('/admin/spaces/:name', requireAdmin, jsonSchemaMiddleware(updateSpaceBody),
    catchPromise(async (req, res) => {
    const name = String(req.params.name);
    if (name === DEFAULT_SPACE && !await spaces.get(name)) {
      // default есть всегда, но в хранилище его может не быть: заводим при первой правке
      await spaces.add({ name });
    }
    if (!await spaces.update(name, req.body)) {
      res.status(404).json(error(`No space "${name}"`, 'SPACE_NOT_FOUND'));
      return;
    }
    log(res, `space "${name}" updated: ${Object.keys(req.body).join(', ')}`);
    res.json(success());
  }));

  app.delete('/admin/spaces/:name', requireAdmin, catchPromise(async (req, res) => {
    const name = String(req.params.name);
    if (name === DEFAULT_SPACE) {
      res.status(400).json(error('The default space cannot be removed', 'DEFAULT_SPACE'));
      return;
    }
    const count = (await countMailings()).get(name) || 0;
    if (count) {
      res.status(409).json(error(
        `Space "${name}" has ${count} mailing(s); move or delete them first`, 'SPACE_NOT_EMPTY'
      ));
      return;
    }
    if (!await spaces.remove(name)) {
      res.status(404).json(error(`No space "${name}"`, 'SPACE_NOT_FOUND'));
      return;
    }
    log(res, `space "${name}" removed`);
    res.json(success());
  }));

  app.put('/admin/spaces/:name/members/:login', requireAdmin, catchPromise(async (req, res) => {
    const { login, name } = req.params as Record<string, string>;
    if (!LOGIN_PATTERN.test(login)) {
      res.status(400).json(error(`Invalid login "${login}"`));
      return;
    }
    if (name === DEFAULT_SPACE && !await spaces.get(name)) {
      await spaces.add({ name });
    }
    if (!await spaces.addMember(name, login)) {
      res.status(404).json(error(`No space "${name}"`, 'SPACE_NOT_FOUND'));
      return;
    }
    log(res, `member "${login}" added to space "${name}"`);
    res.json(success());
  }));

  app.delete('/admin/spaces/:name/members/:login', requireAdmin, catchPromise(async (req, res) => {
    const { login, name } = req.params as Record<string, string>;
    if (!await spaces.removeMember(name, login)) {
      res.status(404).json(error(`No member "${login}" in space "${name}"`, 'MEMBER_NOT_FOUND'));
      return;
    }
    log(res, `member "${login}" removed from space "${name}"`);
    res.json(success());
  }));

  app.post('/admin/mailings/:id/move', requireAdmin, jsonSchemaMiddleware(moveMailingBody),
    catchPromise(async (req, res) => {
    const id = Number(req.params.id);
    const target: string = req.body.space;
    if (!Number.isInteger(id) || id <= 0) {
      res.status(400).json(error('Invalid ID'));
      return;
    }
    if (!await spaceExists(target)) {
      res.status(404).json(error(`No space "${target}"`, 'SPACE_NOT_FOUND'));
      return;
    }
    let previous = DEFAULT_SPACE;
    const moved = await mailings.updateInTransaction(id, mailing => {
      previous = mailing.space || DEFAULT_SPACE;
      mailing.space = target;
    });
    if (!moved) {
      res.status(404).json(error(`No mailing #${id}`, 'MAILING_NOT_FOUND'));
      return;
    }
    log(res, `mailing #${id} moved: ${previous} → ${target}`);
    res.json(success({ previous, space: target }));
  }));

  app.get('/admin/keys', requireAdmin, catchPromise(async (req, res) => {
    const current = getActor(res).key;
    res.json(success((await keys.list()).map((record: ApiKeyRecord) => ({
      createdAt: record.createdAt,
      current: record.name === current,
      lastUsedAt: record.lastUsedAt,
      name: record.name,
      role: toApiRole(record)
    }))));
  }));

  app.post('/admin/keys', requireAdmin, jsonSchemaMiddleware(createKeyBody),
    catchPromise(async (req, res) => {
    const name: string = req.body.name;
    const role = fromApiRole(req.body.role);
    if (role.space && !await spaceExists(role.space)) {
      res.status(404).json(error(`No space "${role.space}"`, 'SPACE_NOT_FOUND'));
      return;
    }
    const key = await keys.add(name, role);
    if (!key) {
      res.status(409).json(error(`Key "${name}" already exists`, 'KEY_EXISTS'));
      return;
    }
    log(res, `key "${name}" issued (${describeRole(role)})`);
    // Значение ключа — только в этом ответе: хранится лишь его хеш
    res.json(success({ key, name }));
  }));

  app.put('/admin/keys/:name/role', requireAdmin, jsonSchemaMiddleware(setKeyRoleBody),
    catchPromise(async (req, res) => {
    const name = String(req.params.name);
    if (name === getActor(res).key) {
      res.status(409).json(error('The key of this request cannot be changed', 'OWN_KEY'));
      return;
    }
    const role = fromApiRole(req.body.role);
    if (role.space && !await spaceExists(role.space)) {
      res.status(404).json(error(`No space "${role.space}"`, 'SPACE_NOT_FOUND'));
      return;
    }
    if (!await keys.setRole(name, role)) {
      res.status(404).json(error(`No key "${name}"`, 'KEY_NOT_FOUND'));
      return;
    }
    log(res, `key "${name}" role changed to ${describeRole(role)}`);
    res.json(success());
  }));

  app.delete('/admin/keys/:name', requireAdmin, catchPromise(async (req, res) => {
    const name = String(req.params.name);
    if (name === getActor(res).key) {
      res.status(409).json(error('The key of this request cannot be revoked', 'OWN_KEY'));
      return;
    }
    const record = (await keys.list()).find(item => item.name === name);
    if (!record) {
      res.status(404).json(error(`No key "${name}"`, 'KEY_NOT_FOUND'));
      return;
    }
    if (record.proxy && req.query.force !== '1') {
      res.status(409).json(error(
        `Key "${name}" is a proxy key: the web interface signs in through it; add ?force=1`,
        'PROXY_KEY'
      ));
      return;
    }
    await keys.revoke(name);
    log(res, `key "${name}" revoked`);
    res.json(success());
  }));
}
