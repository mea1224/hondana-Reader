const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { safeAssetPath, externalUrl, validateOperation } = require('../electron/security.cjs');

test('IPC validation accepts public operations and rejects unsafe requests', () => {
  validateOperation('library', { query: 'book' });
  validateOperation('note:save', { id: 'n', bookId: 'b', color: 'yellow' });
  validateOperation('category:update', { id: 'category', name: 'Favorites' });
  validateOperation('category:delete', { id: 'category' });
  assert.throws(() => validateOperation('shell:open-external', {}), /不允许/);
  assert.throws(() => validateOperation('library', []), /无效/);
  assert.throws(() => validateOperation('library', { value: 'x'.repeat(2 * 1024 * 1024) }), /大小限制/);
});

test('asset and external URL guards stay inside their boundaries', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hondana-assets-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  assert.equal(safeAssetPath(root, '/index.html'), path.join(root, 'index.html'));
  assert.throws(() => safeAssetPath(root, '/../../etc/passwd'), /无效|范围/);
  assert.throws(() => safeAssetPath(root, '/assets\\secret.js'), /无效/);
  assert.equal(externalUrl('https://example.com/read'), 'https://example.com/read');
  assert.throws(() => externalUrl('javascript:alert(1)'), /HTTP/);
});

test('native module persists imported books, FTS search, progress and notes', t => {
  const suffix = process.platform === 'win32' ? '-msvc' : process.platform === 'linux' ? '-gnu' : '';
  const nativePath = path.join(process.cwd(), 'native', `hondana_core.${process.platform}-${process.arch}${suffix}.node`);
  if (!fs.existsSync(nativePath)) { t.skip('Run npm run native:build first'); return; }
  const core = require(nativePath);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hondana-core-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const source = path.join(dir, 'journal.md');
  const db = path.join(dir, 'library.sqlite3');
  fs.writeFileSync(source, '# Journal\n\nA quiet page.');
  const dispatch = (op, payload) => JSON.parse(core.dispatch(db, op, JSON.stringify(payload)));
  const imported = dispatch('import', { paths: [source, source] });
  assert.equal(imported.ids.length, 2);
  assert.equal(imported.ids[0], imported.ids[1]);
  assert.equal(dispatch('library', { query: 'Journal' }).books.length, 1);
  const id = imported.ids[0];
  dispatch('progress:save', { bookId: id, location: { scope: 'document', ratio: 0.4, percent: 40 } });
  dispatch('note:save', { id: 'note-1', bookId: id, rangeLoc: '{}', selectedText: 'quiet', color: 'yellow', content: '**idea**' });
  assert.equal(dispatch('notes:list', { bookId: id })[0].content, '**idea**');
  const category = dispatch('category:create', { name: 'Reading' });
  dispatch('book:update', { id, categoryId: category.id });
  assert.equal(dispatch('category:update', { id: category.id, name: 'Favorites' }).name, 'Favorites');
  assert.equal(dispatch('library', {}).books[0].categoryId, category.id);
  dispatch('category:delete', { id: category.id });
  const library = dispatch('library', {});
  assert.equal(library.categories.length, 0);
  assert.equal(library.books[0].categoryId, null);
  assert.equal(library.books[0].progress.percent, 40);
  assert.equal(dispatch('notes:list', { bookId: id })[0].content, '**idea**');
  dispatch('book:remove', { id });
  assert.equal(dispatch('library', { query: 'Journal' }).books.length, 0);
  assert.equal(dispatch('notes:list', { bookId: id }).length, 0);
});
