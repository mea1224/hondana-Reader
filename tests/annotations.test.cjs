const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

const ruby = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('lib/ruby-text.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, { exports: ruby, TextEncoder });
const exported = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('lib/annotations.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, { exports: exported, require: name => name === './ruby-text' ? ruby : require(name) });

test('text highlights append to one note across EPUB chapters and retain image marks', () => {
  const imageMark = { scope: 'chapter-1.xhtml', imageKey: 'pic.png', strokes: [{ width: 0.018, points: [{ x: 0.1, y: 0.2 }] }] };
  const existing = { scope: 'chapter-1.xhtml', start: 5, end: 10, quote: '第一段', imageMarks: [imageMark] };
  const second = { scope: 'chapter-2.xhtml', start: 12, end: 18, quote: '第二段' };
  const withSecond = exported.addTextMark(existing, second);
  assert.deepEqual(JSON.parse(JSON.stringify(exported.textAnchors(withSecond))), [
    { scope: 'chapter-1.xhtml', start: 5, end: 10, quote: '第一段' },
    { scope: 'chapter-2.xhtml', start: 12, end: 18, quote: '第二段' },
  ]);
  assert.deepEqual(JSON.parse(JSON.stringify(withSecond.imageMarks)), [imageMark]);
  assert.equal(exported.addTextMark(withSecond, second).textMarks.length, 1);
});

test('text highlights append repeatedly within one EPUB chapter and support old anchor records', () => {
  const old = { scope: 'chapter.xhtml', start: 1, end: 3, quote: 'one' };
  const twice = exported.addTextMark(old, { scope: 'chapter.xhtml', start: 8, end: 11, quote: 'two' });
  const thrice = exported.addTextMark(twice, { scope: 'chapter.xhtml', start: 16, end: 21, quote: 'three' });
  assert.deepEqual(JSON.parse(JSON.stringify(exported.textAnchors(thrice).map(mark => mark.quote))), ['one', 'two', 'three']);
});

test('text marks retain ruby display quotes through repeated annotations', () => {
  const displayQuote = '⟦r:e6bca2e5ad97:e3818be38293e38198⟧';
  const first = exported.addTextMark({ scope: 'chapter.xhtml' }, {
    scope: 'chapter.xhtml', start: 4, end: 7, quote: '漢字かんじ', displayQuote,
  });
  const second = exported.addTextMark(first, {
    scope: 'chapter.xhtml', start: 12, end: 15, quote: '漢字かんじ', displayQuote,
  });
  assert.deepEqual(JSON.parse(JSON.stringify(exported.textAnchors(second).map(mark => mark.displayQuote))), [displayQuote, displayQuote]);
});

test('text selection expands to include complete ruby annotations', () => {
  const rubyA = { id: 'ruby-a' };
  const rubyB = { id: 'ruby-b' };
  const calls = [];
  const range = {
    intersectsNode: node => node === rubyA || node === rubyB,
    setStartBefore: node => calls.push(['start', node.id]),
    setEndAfter: node => calls.push(['end', node.id]),
  };
  exported.expandRangeToRuby(range, { querySelectorAll: () => [rubyA, rubyB] });
  assert.deepEqual(calls, [['start', 'ruby-a'], ['end', 'ruby-b']]);
});
