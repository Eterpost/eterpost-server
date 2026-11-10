import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getSpaces } from '../src/controllers/getSpaces';


const stored = [
  { createdAt: '2026-01-01', from: 'Sales <sales@example.com>', name: 'sales', title: 'Sales' },
  { createdAt: '2026-01-01', name: 'news' }
];
const repository: any = { list: async () => stored };
const withDefault: any = {
  list: async () => [...stored, { createdAt: '2026-01-01', name: 'default', title: 'Main' }]
};

async function call (access: object, spaces = repository) {
  let result: any;
  const res: any = {
    json (data: any) {
      result = data;
      return res;
    },
    locals: { spaceAccess: access }
  };
  await getSpaces(spaces)({} as any, res, () => {});
  return result;
}

describe('GET /spaces', () => {
  it('should list only the space of a space key', async () => {
    const body = await call({ allowed: ['sales'], current: 'sales' });
    assert.deepEqual(body, {
      data: [{ from: 'Sales <sales@example.com>', name: 'sales', title: 'Sales' }],
      success: true
    });
  });

  it('should list every space for a proxy admin, with default first', async () => {
    const body = await call({ allowed: 'all' });
    assert.deepEqual(body.data.map((item: any) => item.name), ['default', 'news', 'sales']);
  });

  it('should keep the stored default in order and not duplicate it', async () => {
    const body = await call({ allowed: 'all' }, withDefault);
    assert.deepEqual(body.data.map((item: any) => item.name), ['default', 'news', 'sales']);
    assert.equal(body.data[0].title, 'Main');
  });

  it('should list the spaces of a user that exist, and default always', async () => {
    const body = await call({ allowed: ['default', 'gone', 'news'] });
    assert.deepEqual(body.data.map((item: any) => item.name), ['default', 'news']);
  });

  it('should honour the chosen space of a system key', async () => {
    const body = await call({ allowed: 'all', current: 'news', system: true });
    assert.deepEqual(body.data.map((item: any) => item.name), ['news']);
  });

  it('should be empty without access', async () => {
    assert.deepEqual((await call({ allowed: [] })).data, []);
  });
});
