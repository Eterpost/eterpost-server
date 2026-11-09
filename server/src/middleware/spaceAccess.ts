import { Response } from 'express';
import { ApiKeyRecord, isLegacyKey } from '../ApiKeyRepository';
import { DEFAULT_SPACE, SPACE_NAME_PATTERN, SpaceRepository } from '../SpaceRepository';


/**
 * К каким пространствам рассылок у запроса есть доступ
 */
export interface SpaceAccess {
  allowed: string[] | 'all';
  // текущее пространство: из ключа пространства или заголовка X-Eterpost-Space
  current?: string;
  // старый ключ без роли или запрос без ключа: все пространства, как до их появления
  legacy?: boolean;
  system?: boolean;
}

/**
 * Запрошено пространство, к которому нет доступа (или которого нет: ответ
 * одинаковый, чтобы по нему нельзя было узнать имена чужих пространств)
 */
export class SpaceForbiddenError extends Error {
  constructor (space: string) {
    super(`Space "${space}" is forbidden`);
    this.name = 'SpaceForbiddenError';
  }
}

/**
 * Доступ запроса: record — ключ (null — запрос без ключа), user — X-Remote-User
 * (только для ключа прокси), requested — X-Eterpost-Space
 */
export async function resolveSpaceAccess (
  record: ApiKeyRecord | null, user: string | undefined, requested: string | undefined,
  spaces: SpaceRepository, admins: string[]
): Promise<SpaceAccess> {
  const access = await resolveAllowed(record, user, spaces, admins);
  if (requested === undefined) {
    return access;
  }
  if (access.allowed === 'all') {
    // default есть всегда: в него попадают рассылки, созданные до пространств
    const exists = requested === DEFAULT_SPACE ||
      (SPACE_NAME_PATTERN.test(requested) && Boolean(await spaces.get(requested)));
    if (!exists) {
      throw new SpaceForbiddenError(requested);
    }
  } else if (!access.allowed.includes(requested)) {
    throw new SpaceForbiddenError(requested);
  }
  return { ...access, current: requested };
}

async function resolveAllowed (
  record: ApiKeyRecord | null, user: string | undefined,
  spaces: SpaceRepository, admins: string[]
): Promise<SpaceAccess> {
  if (!record || isLegacyKey(record)) {
    return { allowed: 'all', legacy: true };
  }
  if (record.space) {
    return { allowed: [record.space], current: record.space };
  }
  if (record.system) {
    return { allowed: 'all', system: true };
  }
  // Ключ прокси: пространства пользователя, вошедшего на фронте
  if (!user) {
    return { allowed: [] };
  }
  if (admins.includes(user)) {
    return { allowed: 'all' };
  }
  // Пока участники не заведены, веб-интерфейс после обновления не должен опустеть
  if (!await spaces.hasAnyMembers()) {
    return { allowed: [DEFAULT_SPACE] };
  }
  return { allowed: [...await spaces.getSpacesOfUser(user)].sort() };
}

/**
 * Пространства, рассылки которых видны запросу: текущее, если выбрано, иначе все доступные
 */
export function listedSpaces (access: SpaceAccess): string[] | 'all' {
  return access.current ? [access.current] : access.allowed;
}

/**
 * Видна ли запросу рассылка; рассылка без поля space — в пространстве по умолчанию
 */
export function canSee (access: SpaceAccess, space: string | undefined): boolean {
  const listed = listedSpaces(access);
  return listed === 'all' || listed.includes(space || DEFAULT_SPACE);
}

/**
 * Пространство новой рассылки; null — неясно, в какое (нужен X-Eterpost-Space)
 */
export function spaceForNewMailing (access: SpaceAccess): string | null {
  if (access.current) {
    return access.current;
  }
  if (access.allowed === 'all') {
    return DEFAULT_SPACE;
  }
  return access.allowed.length === 1 ? access.allowed[0] : null;
}

/**
 * Доступ, определённый apiKeyAuth; если его нет (маршрут без проверки ключа),
 * — ни к одному пространству
 */
export function getSpaceAccess (res: Response): SpaceAccess {
  return res.locals.spaceAccess || { allowed: [] };
}
