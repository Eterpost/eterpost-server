import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ApiKeyRecord } from '../src/ApiKeyRepository';
import { Space, SpaceRepository } from '../src/SpaceRepository';
import {
  canSee, listedSpaces, resolveSpaceAccess, SpaceAccess, SpaceForbiddenError, spaceForNewMailing
} from '../src/middleware/spaceAccess';


// Пространства sales и news; ivan — участник обоих
function createSpaces (members: Record<string, string[]> = { news: ['ivan'], sales: ['ivan'] }) {
  return {
    async get (name: string): Promise<Space | null> {
      return name in members ? { createdAt: '2026-11-10T00:00:00.000Z', name } : null;
    },
    async getSpacesOfUser (login: string): Promise<string[]> {
      return Object.keys(members).filter(name => members[name].includes(login));
    },
    async hasAnyMembers (): Promise<boolean> {
      return Object.values(members).some(list => list.length > 0);
    }
  } as unknown as SpaceRepository;
}

function key (role: Partial<ApiKeyRecord> = {}): ApiKeyRecord {
  return { createdAt: '2026-11-10T00:00:00.000Z', hash: 'x', name: 'k', proxy: false, ...role };
}

const admins = ['lav'];

describe('resolveSpaceAccess', () => {
  const spaces = createSpaces();

  it('should give a space key its own space only', async () => {
    assert.deepEqual(
      await resolveSpaceAccess(key({ space: 'sales' }), undefined, undefined, spaces, admins),
      { allowed: ['sales'], current: 'sales' }
    );
    assert.deepEqual(
      await resolveSpaceAccess(key({ space: 'sales' }), undefined, 'sales', spaces, admins),
      { allowed: ['sales'], current: 'sales' }
    );
    await assert.rejects(
      resolveSpaceAccess(key({ space: 'sales' }), undefined, 'news', spaces, admins),
      SpaceForbiddenError
    );
  });

  it('should ignore X-Remote-User for a space key', async () => {
    assert.deepEqual(
      await resolveSpaceAccess(key({ space: 'sales' }), 'lav', undefined, spaces, admins),
      { allowed: ['sales'], current: 'sales' }
    );
  });

  it('should give a system key every space and let it choose one', async () => {
    assert.deepEqual(
      await resolveSpaceAccess(key({ system: true }), undefined, undefined, spaces, admins),
      { allowed: 'all', system: true }
    );
    assert.deepEqual(
      await resolveSpaceAccess(key({ system: true }), undefined, 'news', spaces, admins),
      { allowed: 'all', current: 'news', system: true }
    );
    assert.deepEqual(
      await resolveSpaceAccess(key({ system: true }), undefined, 'default', spaces, admins),
      { allowed: 'all', current: 'default', system: true }
    );
  });

  it('should not let a system key choose a space that does not exist', async () => {
    for (const requested of ['nope', 'Not a name', '../sales']) {
      await assert.rejects(
        resolveSpaceAccess(key({ system: true }), undefined, requested, spaces, admins),
        SpaceForbiddenError
      );
    }
  });

  it('should give an old key and a request without a key every space', async () => {
    assert.deepEqual(
      await resolveSpaceAccess(key(), undefined, undefined, spaces, admins),
      { allowed: 'all', legacy: true }
    );
    assert.deepEqual(
      await resolveSpaceAccess(null, undefined, undefined, spaces, admins),
      { allowed: 'all', legacy: true }
    );
    assert.deepEqual(
      await resolveSpaceAccess(null, undefined, 'news', spaces, admins),
      { allowed: 'all', current: 'news', legacy: true }
    );
    await assert.rejects(
      resolveSpaceAccess(key(), undefined, 'nope', spaces, admins),
      SpaceForbiddenError
    );
  });

  it('should give a proxy user the spaces where they are a member', async () => {
    const proxy = key({ proxy: true });
    assert.deepEqual(
      await resolveSpaceAccess(proxy, 'ivan', undefined, spaces, admins),
      { allowed: ['news', 'sales'] }
    );
    assert.deepEqual(
      await resolveSpaceAccess(proxy, 'ivan', 'sales', spaces, admins),
      { allowed: ['news', 'sales'], current: 'sales' }
    );
    for (const requested of ['nope', 'default']) {
      await assert.rejects(
        resolveSpaceAccess(proxy, 'ivan', requested, spaces, admins),
        SpaceForbiddenError
      );
    }
    assert.deepEqual(
      await resolveSpaceAccess(proxy, 'petr', undefined, spaces, admins),
      { allowed: [] }
    );
    await assert.rejects(
      resolveSpaceAccess(proxy, 'petr', 'sales', spaces, admins),
      SpaceForbiddenError
    );
  });

  it('should give a proxy request without a user no space', async () => {
    const proxy = key({ proxy: true });
    assert.deepEqual(
      await resolveSpaceAccess(proxy, undefined, undefined, spaces, admins),
      { allowed: [] }
    );
    await assert.rejects(
      resolveSpaceAccess(proxy, undefined, 'sales', spaces, admins),
      SpaceForbiddenError
    );
  });

  it('should give an administrator every space through the proxy', async () => {
    const proxy = key({ proxy: true });
    assert.deepEqual(
      await resolveSpaceAccess(proxy, 'lav', undefined, spaces, admins),
      { allowed: 'all' }
    );
    assert.deepEqual(
      await resolveSpaceAccess(proxy, 'lav', 'news', spaces, admins),
      { allowed: 'all', current: 'news' }
    );
    await assert.rejects(
      resolveSpaceAccess(proxy, 'lav', 'nope', spaces, admins),
      SpaceForbiddenError
    );
  });

  it('should give proxy users the default space until members are set up', async () => {
    const empty = createSpaces({ news: [], sales: [] });
    const proxy = key({ proxy: true });
    assert.deepEqual(
      await resolveSpaceAccess(proxy, 'ivan', undefined, empty, admins),
      { allowed: ['default'] }
    );
    await assert.rejects(
      resolveSpaceAccess(proxy, 'ivan', 'sales', empty, admins),
      SpaceForbiddenError
    );
    // без X-Remote-User и без участников — тоже default; когда участники есть — ничего
    assert.deepEqual(
      await resolveSpaceAccess(proxy, undefined, undefined, empty, admins),
      { allowed: ['default'] }
    );
    assert.deepEqual(
      await resolveSpaceAccess(proxy, undefined, undefined, spaces, admins),
      { allowed: [] }
    );
  });
});

describe('space access helpers', () => {
  it('should treat a mailing without a space as the default one', () => {
    assert.equal(canSee({ allowed: ['sales'] }, undefined), false);
    assert.equal(canSee({ allowed: ['default'] }, undefined), true);
    assert.equal(canSee({ allowed: ['sales'] }, 'sales'), true);
    assert.equal(canSee({ allowed: [] }, 'sales'), false);
    assert.equal(canSee({ allowed: 'all' }, 'sales'), true);
  });

  it('should see only the current space when one is chosen', () => {
    const access: SpaceAccess = { allowed: ['news', 'sales'], current: 'sales' };
    assert.equal(canSee(access, 'sales'), true);
    assert.equal(canSee(access, 'news'), false);
    assert.equal(canSee({ allowed: 'all', current: 'news', system: true }, 'sales'), false);
    assert.deepEqual(listedSpaces(access), ['sales']);
    assert.deepEqual(listedSpaces({ allowed: ['news', 'sales'] }), ['news', 'sales']);
    assert.equal(listedSpaces({ allowed: 'all' }), 'all');
  });

  it('should pick a space for a new mailing only when it is unambiguous', () => {
    assert.equal(spaceForNewMailing({ allowed: [] }), null);
    assert.equal(spaceForNewMailing({ allowed: 'all' }), 'default');
    assert.equal(spaceForNewMailing({ allowed: ['a', 'b'] }), null);
    assert.equal(spaceForNewMailing({ allowed: ['a'] }), 'a');
    assert.equal(spaceForNewMailing({ allowed: ['a', 'b'], current: 'b' }), 'b');
    assert.equal(spaceForNewMailing({ allowed: 'all', current: 'news' }), 'news');
  });
});
