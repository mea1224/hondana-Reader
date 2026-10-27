const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

const rubyExports = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('lib/ruby-text.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, { exports: rubyExports, TextEncoder });
const formatExports = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('lib/note-format.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, { exports: formatExports });
const exportsObject = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('lib/notes-export.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, { exports: exportsObject, require: path => path === './note-format' ? formatExports : path === './ruby-text' ? rubyExports : require(path) });
const { formatNotesMarkdown, notesFilename } = exportsObject;
const { plainNoteText } = formatExports;
const book = { title: '海边札记', author: '林青', fileType: 'md' };

test('notes export preserves multiline quotes, rich note text and PDF page locations', () => {
  const result = formatNotesMarkdown(book, [{
    updatedAt: '2026-10-22T01:00:00Z', color: 'blue', selectedText: '海边\n第二行',
    content: 'hondana-rich-v1:今天<br><strong>最新想法</strong>', rangeLoc: '{"scope":"pdf/4"}',
  }]);
  assert.match(result, /^# 海边札记\n/);
  assert.match(result, /作者：林青/);
  assert.match(result, /共 1 条笔记与高亮/);
  assert.match(result, /蓝色/);
  assert.match(result, /> 海边\n> 第二行/);
  assert.match(result, /今天\n最新想法/);
  assert.doesNotMatch(result, /hondana-rich-v1|<strong>/);
  assert.match(result, /位置：pdf\/4/);
});

test('notes export converts encoded ruby quotes to readable plain text', () => {
  const result = formatNotesMarkdown(book, [{
    updatedAt: '2026-10-22T01:00:00Z', color: 'yellow',
    selectedText: '⟦r:e6bca2e5ad97:e3818be38293e38198⟧', content: '', rangeLoc: '{}',
  }]);
  assert.match(result, /> 漢字（かんじ）/);
  assert.doesNotMatch(result, /⟦r:/);
});

test('notes export tolerates legacy anchors and empty books', () => {
  const result = formatNotesMarkdown(book, [{ updatedAt: '2026-10-22T01:00:00Z', color: 'yellow', selectedText: '', content: '保留笔记', rangeLoc: 'not json' }]);
  assert.match(result, /保留笔记/);
  assert.match(formatNotesMarkdown(book, []), /暂无笔记。/);
  assert.equal(notesFilename('a/b:c?'), 'a-b-c--笔记.md');
  assert.equal(notesFilename('...'), '未命名图书-笔记.md');
});

test('legacy note Markdown is exported as literal plain text', () => {
  const result = formatNotesMarkdown(book, [{ updatedAt: '2026-10-22T01:00:00Z', color: 'yellow', selectedText: '', content: '**按原样显示**', rangeLoc: '{}' }]);
  assert.match(result, /\*\*按原样显示\*\*/);
});

test('rich note formatting becomes readable plain text without changing legacy text', () => {
  assert.equal(plainNoteText('hondana-rich-v1:记住 &lt;原句&gt;<br><strong>重点</strong>'), '记住 <原句>\n重点');
  assert.equal(plainNoteText('**这只是原始文字**'), '**这只是原始文字**');
});
