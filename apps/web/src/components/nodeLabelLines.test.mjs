import assert from 'node:assert/strict';
import test from 'node:test';
import { nodeLabelLines } from './nodeLabelLines.ts';

const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
const measure = text => Array.from(segmenter.segment(text)).reduce((width, { segment }) => width + (segment === '-' ? 4 : segment === ' ' ? 3 : 8), 0);

test('long words reserve continuation width and reconstruct the exact name', () => {
  const name = 'CustomerTransactionIdentifier';
  const lines = nodeLabelLines(name, measure);
  assert.deepEqual(lines, ['CustomerT-', 'ransactio-', 'nIdentifi-', 'er']);
  assert.ok(lines.every(line => measure(line) <= 76));
  assert.ok(lines.slice(0, -1).every(line => line.endsWith('-')));
  assert.ok(!lines.at(-1).endsWith('-'));
  assert.equal(lines.map((line, index) => index < lines.length - 1 ? line.slice(0, -1) : line).join(''), name);
});

test('natural word and existing hyphen boundaries do not add continuation marks', () => {
  for (const name of ['Order  Detail Name', 'Customer-Transaction']) {
    const lines = nodeLabelLines(name, measure);
    assert.ok(lines.every(line => measure(line) <= 76));
    assert.ok(lines.every(line => !line.includes('--')));
    if (name.startsWith('Order')) {
      assert.equal(lines.join(''), name);
      assert.ok(lines.every(line => !line.endsWith('-')));
    } else assert.equal(lines[0], 'Customer-');
  }
});

test('Unicode combining marks, emoji sequences and long CJK names remain whole graphemes', () => {
  for (const grapheme of ['e\u0301', '👩🏽‍💻', '𠮷', '界']) {
    const name = grapheme.repeat(125);
    const lines = nodeLabelLines(name, measure);
    assert.ok(lines.length > 1 && lines.length <= 125);
    assert.ok(lines.every(line => measure(line) <= 76));
    const restored = lines.map((line, index) => index < lines.length - 1 ? line.slice(0, -1) : line).join('');
    assert.equal(restored, name);
    assert.ok(lines.every(line => Array.from(segmenter.segment(line.replace(/-$/, ''))).every(({ segment }) => segment === grapheme)));
  }
});

test('empty labels and overwide indivisible graphemes terminate without extra hyphens', () => {
  assert.deepEqual(nodeLabelLines('', measure), []);
  assert.deepEqual(nodeLabelLines('👩🏽‍💻X', () => 100), ['👩🏽‍💻', 'X']);
  assert.deepEqual(nodeLabelLines('Exact', measure), ['Exact']);
});
