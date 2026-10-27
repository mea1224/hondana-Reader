const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

const exported = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('lib/image-annotations.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, { exports: exported });

test('one note keeps multiple strokes and locations for EPUB images', () => {
  const original = { scope: 'chapter/one', quote: 'caption', start: 4, end: 11 };
  const first = { points: [{ x: 0.1, y: 0.2 }, { x: 0.8, y: 0.9 }], width: 0.02 };
  const second = { points: [{ x: 0.5, y: 0.5 }], width: 0.02 };
  const once = exported.addImageStroke(original, 'chapter/one', 'img-a', first);
  const twice = exported.addImageStroke(once, 'chapter/one', 'img-a', second);
  const other = exported.addImageStroke(twice, 'chapter/two', 'img-b', first);
  const third = exported.addImageStroke(other, 'chapter/one', 'img-a', first);
  assert.equal(twice.scope, 'chapter/one');
  assert.equal(twice.quote, 'caption');
  assert.equal(twice.imageMarks[0].strokes.length, 2);
  assert.equal(other.imageMarks.length, 2);
  assert.deepEqual(JSON.parse(JSON.stringify(other.imageMarks[1].strokes[0])), first);
  assert.deepEqual(JSON.parse(JSON.stringify(third.imageMarks.map(mark => mark.imageKey))), ['img-b', 'img-a']);
  assert.equal(third.imageMarks[1].strokes.length, 3);
});

test('one PDF note can span pages and undo removes only its latest stroke', () => {
  const first = { points: [{ x: 0.1, y: 0.2 }], width: 0.02 };
  const second = { points: [{ x: 0.6, y: 0.7 }], width: 0.02 };
  const withTwo = exported.addImageStroke(exported.addImageStroke({ scope: 'pdf/0' }, 'pdf/0', 'pdf-page-0', first), 'pdf/0', 'pdf-page-0', second);
  const withPageTwo = exported.addImageStroke(withTwo, 'pdf/1', 'pdf-page-1', first);
  const oneLeft = exported.undoImageStroke(withPageTwo);
  assert.deepEqual(JSON.parse(JSON.stringify(oneLeft.imageMarks[0].strokes)), [first, second]);
  assert.equal(oneLeft.imageMarks.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(exported.undoImageStroke(oneLeft).imageMarks[0].strokes)), [first]);
  assert.equal(exported.undoImageStroke(exported.undoImageStroke(oneLeft)).imageMarks.length, 0);
});

test('pointer coordinates clamp to the image and brush colors remain translucent', () => {
  assert.deepEqual(JSON.parse(JSON.stringify(exported.imagePoint(75, 70, { left: 10, top: 20, width: 100, height: 100 }))), { x: 0.65, y: 0.5 });
  assert.equal(exported.imagePoint(-20, 400, { left: 10, top: 20, width: 100, height: 100 }).x, 0);
  assert.ok(exported.imageOpacity > 0 && exported.imageOpacity < 0.5);
  assert.ok(exported.defaultBrushWidth > 0 && exported.defaultBrushWidth < 0.1);
  assert.deepEqual(Object.keys(exported.imageColors).sort(), ['blue', 'coral', 'green', 'yellow']);
});
