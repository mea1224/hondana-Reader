const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const { webcrypto } = require('node:crypto');

function preview(storage = new Map()) {
  const exports = {};
  const code = ts.transpileModule(fs.readFileSync('lib/api.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  vm.runInNewContext(code, { exports, window: {}, crypto: webcrypto, localStorage: {
    getItem: key => storage.get(key) || null,
    setItem: (key, value) => storage.set(key, value),
  } });
  return exports;
}

test('browser import, notes and progress survive a new preview instance', async () => {
  const storage = new Map();
  let api = preview(storage);
  const result = await api.importMarkdown([{ name: 'Reading.md', size: 20, text: async () => '# Reading\n\nA quiet day.' }]);
  const id = result.ids[0];
  assert.equal(result.errors.length, 0);
  assert.equal((await api.request('library', { query: 'reading' })).books.length, 1);
  assert.equal((await api.request('library', { query: '  ' })).books.length, 1);
  await api.request('note:save', { id: 'different-note-id', bookId: id, color: 'blue', content: '**keep me**', rangeLoc: '{}', selectedText: 'quiet' });
  await api.request('progress:save', { bookId: id, location: { scope: 'document', percent: 42, ratio: 0.42 } });
  api = preview(storage);
  assert.equal((await api.request('notes:list', { bookId: id }))[0].content, '**keep me**');
  assert.equal((await api.request('library')).books[0].progress.percent, 42);
  assert.match((await api.request('book:open', { id })).markdown, /quiet day/);
  await api.request('book:remove', { id });
  assert.equal((await api.request('notes:list', { bookId: id })).length, 0);
});

test('browser import reports unsupported files without fabricating a book', async () => {
  const api = preview();
  const result = await api.importMarkdown([{ name: 'Book.pdf', size: 10, text: async () => 'not markdown' }]);
  assert.equal(result.ids.length, 0);
  assert.equal(result.errors.length, 1);
  assert.equal((await api.request('library')).books.length, 0);
});

test('browser import deduplicates unchanged files while preserving notes and progress', async () => {
  const storage = new Map();
  const api = preview(storage);
  const file = { name: 'Same.md', size: 10, text: async () => '# Same' };
  const first = await api.importMarkdown([file]);
  await api.request('note:save', { id: 'note-1', bookId: first.ids[0], color: 'blue', content: 'Keep this' });
  await api.request('progress:save', { bookId: first.ids[0], location: { scope: 'document', ratio: 0.5, percent: 50 } });
  const second = await api.importMarkdown([file]);
  assert.deepEqual(second.ids, first.ids);
  assert.equal((await api.request('library')).books.length, 1);
  assert.equal((await api.request('notes:list', { bookId: first.ids[0] }))[0].content, 'Keep this');
  assert.equal((await api.request('library')).books[0].progress.percent, 50);
  const changed = await api.importMarkdown([{ ...file, text: async () => '# Different contents' }]);
  assert.notEqual(changed.ids[0], first.ids[0]);
  assert.equal((await api.request('library')).books.length, 2);
});

test('browser preview rejects invalid categories, colors and cross-book note replacement', async () => {
  const api = preview();
  const result = await api.importMarkdown(['First.md', 'Second.md'].map(name => ({ name, size: 10, text: async () => '# Test' })));
  const [first, second] = result.ids;
  await api.request('note:save', { id: 'shared-note', bookId: first, color: 'blue', content: 'Original' });
  await assert.rejects(api.request('note:save', { id: 'other-note', bookId: first, color: 'orange' }), /颜色/);
  await assert.rejects(api.request('note:save', { id: 'shared-note', bookId: second, color: 'yellow', content: 'Overwrite' }), /不属于/);
  await assert.rejects(api.request('book:update', { id: first, title: 'Changed', categoryId: 'missing' }), /分类/);
  await assert.rejects(api.request('category:create'), /分类名称/);
  assert.equal((await api.request('notes:list', { bookId: first }))[0].content, 'Original');
  assert.equal((await api.request('library')).books.find(book => book.id === first).title, 'First');
  const category = await api.request('category:create', { name: 'Collection' });
  await api.request('book:update', { id: first, categoryId: category.id });
  assert.equal((await api.request('library')).books.find(book => book.id === first).categoryId, category.id);
});

test('browser preview supports category editing and removal', async () => {
  const api = preview();
  const { ids: [bookId] } = await api.importMarkdown([{ name: 'Categorized.md', size: 12, text: async () => '# Saved book' }]);
  await api.request('note:save', { id: 'keep-note', bookId, color: 'yellow', content: 'Keep this note' });
  await api.request('progress:save', { bookId, location: { scope: 'document', ratio: 0.4, percent: 40 } });
  const category = await api.request('category:create', { name: 'Reading' });
  await api.request('book:update', { id: bookId, categoryId: category.id });
  const updated = await api.request('category:update', { id: category.id, name: ' Favorites ' });
  assert.equal(updated.name, 'Favorites');
  assert.equal((await api.request('library')).categories[0].name, 'Favorites');
  await assert.rejects(api.request('category:update', { id: category.id, name: ' ' }), /分类名称/);
  await api.request('category:create', { name: 'Other' });
  await assert.rejects(api.request('category:update', { id: category.id, name: 'Other' }), /分类已存在/);
  await api.request('category:delete', { id: category.id });
  const library = await api.request('library');
  assert.equal(library.books[0].id, bookId);
  assert.equal(library.books[0].categoryId, null);
  assert.equal(library.books[0].progress.percent, 40);
  assert.equal(library.categories.length, 1);
  assert.equal(library.categories[0].name, 'Other');
  assert.equal((await api.request('notes:list', { bookId }))[0].content, 'Keep this note');
  await assert.rejects(api.request('category:delete', { id: category.id }), /找不到分类/);
});

test('browser preview persists and restores image brush strokes inside note locations', async () => {
  const storage = new Map();
  let api = preview(storage);
  const { ids: [bookId] } = await api.importMarkdown([{ name: 'Images.md', size: 18, text: async () => '# Images' }]);
  const location = {
    scope: 'chapter.xhtml',
    start: 5, end: 10, quote: '第一处文字',
    textMarks: [
      { scope: 'chapter.xhtml', start: 20, end: 25, quote: '第二处文字' },
      { scope: 'chapter-two.xhtml', start: 8, end: 13, quote: '第三处文字' },
    ],
    imageMarks: [
      {
        scope: 'chapter.xhtml', imageKey: '24:OPS/images/cover.png',
        strokes: [
          { width: 0.018, points: [{ x: 0.12, y: 0.3 }, { x: 0.78, y: 0.66 }] },
          { width: 0.018, points: [{ x: 0.2, y: 0.4 }, { x: 0.6, y: 0.7 }] },
        ],
      },
      { scope: 'chapter.xhtml', imageKey: '25:OPS/images/diagram.png', strokes: [{ width: 0.018, points: [{ x: 0.3, y: 0.2 }, { x: 0.8, y: 0.5 }] }] },
    ],
  };
  await api.request('note:save', { id: 'painted-note', bookId, color: 'coral', rangeLoc: JSON.stringify(location), selectedText: '', content: '' });
  api = preview(storage);
  const restored = await api.request('notes:list', { bookId });
  assert.deepEqual(JSON.parse(restored[0].rangeLoc), location);
});
