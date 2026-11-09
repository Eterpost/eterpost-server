import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { applyTracking, createTrackingToken, isTrackingToken } from '../src/tracking';


describe('applyTracking', () => {
  const base = 'https://lists.example.com/';

  it('should wrap http(s) links and keep the original addresses', () => {
    const { html, links } = applyTracking(
      '<p><a href="https://example.com/a?x=1&amp;y=2">A</a> ' +
      '<a class=\'b\' href=\'http://example.com/b\'>B</a></p>',
      base, 5, 'tok'
    );
    assert.deepEqual(links, ['https://example.com/a?x=1&y=2', 'http://example.com/b']);
    assert.match(html, /<a href="https:\/\/lists\.example\.com\/t\/c\/5\/tok\/0">A<\/a>/);
    assert.match(html, /<a class='b' href='https:\/\/lists\.example\.com\/t\/c\/5\/tok\/1'>B<\/a>/);
  });

  it('should not wrap mailto, anchors and skipped prefixes', () => {
    const source = '<a href="mailto:a@example.com">m</a><a href="#top">t</a>' +
      '<a href="https://lists.example.com/unsubscribe?email=a@example.com">u</a>';
    const { html, links } = applyTracking(
      source, base, 5, 'tok', ['https://lists.example.com/unsubscribe']
    );
    assert.deepEqual(links, []);
    assert.ok(html.startsWith(source));
  });

  it('should add the open counter before </body> or at the end', () => {
    const pixel = '<img src="https://lists.example.com/t/o/5/tok"';
    const inBody = applyTracking('<html><body><p>x</p></body></html>', base, 5, 'tok').html;
    assert.ok(inBody.includes(pixel + ' width="1"'));
    assert.match(inBody, /<img [^>]+><\/body><\/html>$/);
    assert.ok(applyTracking('<p>x</p>', base, 5, 'tok').html.startsWith('<p>x</p>' + pixel));
  });

  it('should make tokens that pass the check', () => {
    const token = createTrackingToken();
    assert.equal(isTrackingToken(token), true);
    assert.notEqual(token, createTrackingToken());
    assert.equal(isTrackingToken('../x'), false);
  });
});
