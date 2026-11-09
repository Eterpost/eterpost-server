import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { toEmailDocument } from '../src/emailDocument';


describe('toEmailDocument', () => {
  it('should wrap a fragment into a document for light and dark themes', () => {
    const html = toEmailDocument('<p>Привет</p>');
    assert.match(html, /^<!doctype html>/);
    assert.match(html, /<meta name="color-scheme" content="light dark">/);
    assert.match(html, /color-scheme: light dark/);
    assert.match(html, /<body>\n<p>Привет<\/p>\n<\/body>/);
  });

  it('should keep a complete document as is', () => {
    for (const html of [
      '<!DOCTYPE html><html><body style="background:#fff">x</body></html>',
      '<html lang="ru"><body>x</body></html>',
      '<body>x</body>'
    ]) {
      assert.equal(toEmailDocument(html), html);
    }
  });
});
