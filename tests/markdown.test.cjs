const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

const plugins = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync('lib/markdown.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, { exports: plugins });

async function render(text, anchors) {
  const { default: Markdown } = await import('react-markdown');
  return renderToStaticMarkup(React.createElement(Markdown, {
    rehypePlugins: [plugins.rubyAnnotations, plugins.headingIds, [plugins.epubAnchors, { anchors }]], children: text,
  }));
}

test('EPUB ruby markers render semantic ruby with compact annotation text', async () => {
  const html = await render('⟦r:e6bca2e5ad97:e3818be38293e38198⟧の読み', []);
  assert.match(html, /<ruby><rb>漢字<\/rb><rt>かんじ<\/rt><\/ruby>の読み/);
  assert.doesNotMatch(html, /e6bca2e5ad97/);
  const heading = await render('# ⟦r:e6bca2e5ad97:e3818be38293e38198⟧', []);
  assert.match(heading, /<h1 id="漢字"><ruby>/);
});

test('note quote renderer displays ruby readings above their base text', () => {
  const rubyText = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync('lib/ruby-text.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText, { exports: rubyText, TextEncoder });
  const component = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync('components/ruby-text.tsx', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText, { exports: component, require: name => name === '../lib/ruby-text' ? rubyText : require(name) });
  const html = renderToStaticMarkup(React.createElement(component.RubyText, {
    text: '⟦r:e6bca2e5ad97:e3818be38293e38198⟧',
  }));
  assert.match(html, /<ruby><rb>漢字<\/rb><rt>かんじ<\/rt><\/ruby>/);
  assert.doesNotMatch(html, /⟦r:|e6bca2/);
});

test('EPUB anchors retain source IDs and survive merged Markdown blocks', async () => {
  const html = await render('# 第一章\n\n> 第一段\n\n> 第二段\n\n正文', [
    { id: 'chapter-start', block: 0, line: 1 },
    { id: 'quote-one', block: 1, line: 3 },
    { id: 'quote-two', block: 2, line: 5 },
    { id: '小节', block: 3, line: 7 },
  ]);
  assert.match(html, /data-epub-anchor="chapter-start"[^>]*><\/span><h1 id="第一章">/);
  assert.match(html, /data-epub-anchor="quote-one"[^>]*><\/span><blockquote>/);
  assert.match(html, /data-epub-anchor="quote-two"[^>]*><\/span><blockquote>[\s\S]*第二段<\/p>/);
  assert.match(html, /data-epub-anchor="小节"[^>]*><\/span><p>正文<\/p>/);
});

test('legacy EPUB anchors and Markdown heading IDs remain supported', async () => {
  const html = await render('Title\n=====\n\n# Title\n\nParagraph', [
    { id: 'original-id', block: 2 },
  ]);
  assert.match(html, /<h1 id="title">Title<\/h1>/);
  assert.match(html, /<h1 id="title-1">Title<\/h1>/);
  assert.match(html, /data-epub-anchor="original-id"[^>]*><\/span><p>Paragraph<\/p>/);
});

test('EPUB anchors locate nested items after Markdown combines lists', async () => {
  const html = await render('- 第一项\n\n- 第二项\n\n正文', [
    { id: 'second-item', block: 1, line: 3 },
    { id: 'after-list', block: 2, line: 5 },
  ]);
  assert.match(html, /data-epub-anchor="second-item"[^>]*><\/span><li>/);
  assert.match(html, /data-epub-anchor="after-list"[^>]*><\/span><p>正文<\/p>/);
});

test('reader renders EPUB images with archive paths decoded exactly once', async () => {
  const markdown = await import('react-markdown');
  const gfm = await import('remark-gfm');
  const api = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync('lib/api.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText, { exports: api });
  const component = {};
  const imageLayer = {};
  const imageFns = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync('lib/image-annotations.ts', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText, { exports: imageFns });
  vm.runInNewContext(ts.transpileModule(fs.readFileSync('components/annotated-image.tsx', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText, { exports: imageLayer, require: name => {
    if (name === 'react' || name === 'react/jsx-runtime') return require(name);
    if (name === '../lib/annotations') return { readAnchor: value => { try { return JSON.parse(value); } catch { return null; } } };
    if (name === '../lib/image-annotations') return imageFns;
    return require(name);
  } });
  vm.runInNewContext(ts.transpileModule(fs.readFileSync('components/markdown.tsx', 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText, { exports: component, require: name => {
    if (name === 'react-markdown') return { __esModule: true, ...markdown };
    if (name === 'remark-gfm') return { __esModule: true, ...gfm };
    if (name === '../lib/markdown') return plugins;
    if (name === '../lib/api') return api;
    if (name === './annotated-image') return imageLayer;
    return require(name);
  } });
  const html = renderToStaticMarkup(React.createElement(component.Markdown, {
    resourceBookId: 'book-id', anchors: [{ id: 'illustration', block: 0, line: 1 }],
    text: '![插图](<epub-resource:OPS/images/%E4%B8%AD%20%2520%25.png>)\n\n[bad](javascript:alert)\n\n![remote](https://example.invalid/tracker.png)',
  }));
  assert.match(html, /<img[^>]*src="hondana-resource:\/\/book\/book-id\/OPS\/images\/%E4%B8%AD%20%2520%25.png"[^>]*alt="插图"/);
  assert.match(html, /data-epub-anchor="illustration"/);
  assert.doesNotMatch(html, /javascript:|<img[^>]*example.invalid/);
  const marked = renderToStaticMarkup(React.createElement(imageLayer.ImageAnnotationContext.Provider, {
    value: {
      notes: [{ id: 'paint-note', color: 'coral', rangeLoc: JSON.stringify({ scope: 'chapter.xhtml', imageMarks: [{ scope: 'chapter.xhtml', imageKey: '0:OPS/images/cover.png', strokes: [{ width: 0.018, points: [{ x: 0.1, y: 0.2 }, { x: 0.7, y: 0.8 }] }] }] }) }],
      drawing: { noteId: 'paint-note', color: 'coral' }, onStroke() {}, onSelect() {},
    },
  }, React.createElement(component.Markdown, {
    resourceBookId: 'book-id', imageScope: 'chapter.xhtml',
    text: '![cover](<epub-resource:OPS/images/cover.png>)',
  })));
  assert.match(marked, /data-note-id="paint-note"/);
  assert.match(marked, /stroke="#e57358"/);
  assert.match(marked, /opacity="0\.32"/);
  const withoutBook = renderToStaticMarkup(React.createElement(component.Markdown, {
    text: '![image](<epub-resource:OPS/private.png>)',
  }));
  assert.doesNotMatch(withoutBook, /<img/);
});
