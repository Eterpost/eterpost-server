import { Request, Response } from 'express';
import { success } from '../utils/response';
import { catchPromise } from '../utils/catchPromise';
import { DEFAULT_SPACE, SpaceRepository } from '../SpaceRepository';
import { getSpaceAccess, listedSpaces } from '../middleware/spaceAccess';


/**
 * Пространства, которыми может пользоваться запрос: имя, название, адрес
 * отправителя. default есть всегда, даже если не заведено
 */
export function getSpaces (spaceRepository: SpaceRepository) {
  return catchPromise(async function (req: Request, res: Response) {
    const listed = listedSpaces(getSpaceAccess(res));
    const stored = await spaceRepository.list();
    const allowed = (name: string) => listed === 'all' || listed.includes(name);
    const spaces = stored.filter(space => allowed(space.name));
    if (allowed(DEFAULT_SPACE) && !spaces.some(space => space.name === DEFAULT_SPACE)) {
      spaces.push({ createdAt: '', name: DEFAULT_SPACE });
    }
    spaces.sort((a, b) => a.name.localeCompare(b.name));
    res.json(success(spaces.map(({ from, name, title }) => ({ from, name, title }))));
  });
}
