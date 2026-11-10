import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AttachmentStore } from '../src/AttachmentStore';


describe('AttachmentStore', () => {
  let dir: string;
  let store: AttachmentStore;

  before(async () => {
    dir = await mkdtemp(join(tmpdir(), 'att-'));
    store = new AttachmentStore(join(dir, 'store'));
    assert.equal(await store.init(), true);
    assert.equal(store.available, true);
  });

  after(async () => {
    await rm(dir, { force: true, recursive: true });
  });

  it('should save a file under a random id', async () => {
    const id = await store.save(1, Buffer.from('price'));
    assert.match(id, /^[0-9a-f]{16}$/);
    assert.equal(await readFile(store.path(1, id), 'utf8'), 'price');
    assert.equal(await store.exists(1, id), true);
    assert.equal(await store.exists(1, '0000000000000000'), false);
    assert.deepEqual(await readdir(join(dir, 'store', '1')), [id]);
  });

  it('should copy files to another mailing under new ids', async () => {
    const id = await store.save(2, Buffer.from('copy me'));
    const info = { contentType: 'application/pdf', filename: 'p.pdf', id, size: 7 };
    const [copy] = await store.copy(2, 3, [info]);
    assert.notEqual(copy.id, id);
    assert.deepEqual({ ...copy, id }, info);
    assert.equal(await readFile(store.path(3, copy.id), 'utf8'), 'copy me');
    assert.equal(await store.exists(2, id), true);
  });

  it('should remove one file and all files of a mailing', async () => {
    const id = await store.save(4, Buffer.from('a'));
    const other = await store.save(4, Buffer.from('b'));
    await store.remove(4, id);
    await store.remove(4, id);
    assert.equal(await store.exists(4, id), false);
    assert.equal(await store.exists(4, other), true);
    await store.removeAll(4);
    await store.removeAll(4);
    assert.equal(await store.exists(4, other), false);
  });

  it('should refuse an id that is not its own', () => {
    assert.throws(() => store.path(1, '../x'));
    assert.throws(() => store.path(1, 'ABCDEF0123456789'));
  });

  it('should be unavailable when the directory cannot be created', async () => {
    await writeFile(join(dir, 'file'), '');
    const broken = new AttachmentStore(join(dir, 'file', 'sub'));
    assert.equal(await broken.init(), false);
    assert.equal(broken.available, false);
  });
});
