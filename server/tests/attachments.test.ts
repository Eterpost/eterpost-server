import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  detectContentType, getAttachmentsConfig, normalizeFilename, totalSize
} from '../src/attachments';


describe('attachments', () => {
  it('should keep only the last part of a path in the file name', () => {
    assert.equal(normalizeFilename('../../etc/passwd'), 'passwd');
    assert.equal(normalizeFilename('C:\\x\\прайс.pdf'), 'прайс.pdf');
  });

  it('should drop control characters from the file name', () => {
    assert.equal(normalizeFilename('a\u0000b\n.pdf'), 'ab.pdf');
  });

  it('should reject an empty file name', () => {
    assert.equal(normalizeFilename('   '), null);
    assert.equal(normalizeFilename(''), null);
    assert.equal(normalizeFilename(undefined), null);
    assert.equal(normalizeFilename(42), null);
  });

  it('should shorten a long file name keeping the extension', () => {
    const name = normalizeFilename('x'.repeat(300) + '.pdf')!;
    assert.equal(name.length, 200);
    assert.ok(name.endsWith('.pdf'));
  });

  it('should detect the content type by the extension', () => {
    assert.equal(detectContentType('Прайс.PDF'), 'application/pdf');
    assert.equal(detectContentType('a.pdf', 'application/octet-stream'), 'application/pdf');
    assert.equal(detectContentType('noext'), 'application/octet-stream');
  });

  it('should prefer the declared content type', () => {
    assert.equal(detectContentType('a.bin', 'text/csv'), 'text/csv');
  });

  it('should sum attachment sizes', () => {
    assert.equal(totalSize(undefined), 0);
    assert.equal(totalSize([
      { contentType: 'a/b', filename: 'a', id: '1', size: 3 },
      { contentType: 'a/b', filename: 'b', id: '2', size: 4 }
    ]), 7);
  });

  it('should take attachment settings with defaults', () => {
    assert.deepEqual(getAttachmentsConfig({ server: {} }), {
      dir: 'data/attachments', maxSize: 10485760
    });
    assert.deepEqual(getAttachmentsConfig({ server: { attachments: { dir: '/x', maxSize: 5 } } }), {
      dir: '/x', maxSize: 5
    });
  });
});
