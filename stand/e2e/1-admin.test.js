// Администрирование: админ заводит пространство с участником, выпускает ключ
// пространства, и этим ключом «сайт» создаёт рассылку в нём
const { describe, it, after } = require('node:test');
const assert = require('node:assert/strict');
const { ADMIN_KEY, api, rawApi, SALES_KEY } = require('./lib');


describe('administration', function () {
  // Стенд с --keep можно прогонять повторно: имена каждый раз новые
  const suffix = Date.now().toString(36);
  const space = `e2e-${suffix}`;
  const keyName = `e2e-site-${suffix}`;
  let siteKey;
  let mailingId;

  after(async function () {
    if (mailingId) {
      await rawApi(`/mailings/${mailingId}`, 'DELETE', undefined, ADMIN_KEY);
    }
    await rawApi(`/admin/keys/${keyName}`, 'DELETE', undefined, ADMIN_KEY);
    await rawApi(`/admin/spaces/${space}`, 'DELETE', undefined, ADMIN_KEY);
  });

  it('knows the administrator and refuses others', async function () {
    assert.equal((await api('/me', 'GET', undefined, ADMIN_KEY)).admin, true);
    assert.equal((await api('/me', 'GET', undefined, SALES_KEY)).admin, false);
    const denied = await rawApi('/admin/keys', 'GET', undefined, SALES_KEY);
    assert.equal(denied.status, 403);
    assert.equal(denied.json.code, 'ADMIN_REQUIRED');
  });

  it('creates a space with a member and a key that works in it', async function () {
    await api('/admin/spaces', 'POST', { name: space, title: 'E2E admin' }, ADMIN_KEY);
    await api(`/admin/spaces/${space}/members/e2e-user`, 'PUT', {}, ADMIN_KEY);
    const spaces = await api('/admin/spaces', 'GET', undefined, ADMIN_KEY);
    const created = spaces.find(item => item.name === space);
    assert.deepEqual(created.members, ['e2e-user']);
    assert.equal(created.mailingCount, 0);

    const issued = await api('/admin/keys', 'POST',
      { name: keyName, role: { space, type: 'space' } }, ADMIN_KEY);
    siteKey = issued.key;
    assert.match(siteKey, /^ep_/);

    mailingId = (await api('/mailings', 'POST', {
      html: '<p>Hi</p>', name: 'E2E admin space mailing',
      receivers: [{ email: 'admin-e2e@example.com' }], subject: 'Hi'
    }, siteKey)).id;
    assert.equal((await api(`/mailings/${mailingId}`, 'GET', undefined, siteKey)).space, space);

    // Админ видит рассылку в общем списке; удалить непустое пространство нельзя
    const all = await api('/mailings', 'GET', undefined, ADMIN_KEY);
    assert.ok(all.some(mailing => mailing.id === mailingId && mailing.space === space));
    const busy = await rawApi(`/admin/spaces/${space}`, 'DELETE', undefined, ADMIN_KEY);
    assert.equal(busy.json.code, 'SPACE_NOT_EMPTY');
  });

  it('revokes the key at once', async function () {
    await api(`/admin/keys/${keyName}`, 'DELETE', undefined, ADMIN_KEY);
    assert.equal((await rawApi('/me', 'GET', undefined, siteKey)).status, 401);
  });
});
