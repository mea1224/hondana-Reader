'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Archive, ArrowUpRight, BookOpen, ChevronRight, FilePlus2, FolderPlus, Grid2X2, List, LoaderCircle, Menu, Pencil, Plus, Search, Trash2, Upload, X } from 'lucide-react';
import { desktop, errorMessage, importMarkdown, request } from '../lib/api';
import type { Book, Category, ImportResult, Library } from '../lib/types';
import Reader from '../components/reader';
import Cover from '../components/cover';

export default function Home() {
  const [books, setBooks] = useState<Book[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [filter, setFilter] = useState('all');
  const [query, setQuery] = useState('');
  const [view, setView] = useState<'grid' | 'list'>('grid');
  const [reader, setReader] = useState<Book | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [browser, setBrowser] = useState(false);
  const [sidebar, setSidebar] = useState(true);
  const [categoryInput, setCategoryInput] = useState<string | null>(null);
  const [categoryEdit, setCategoryEdit] = useState<Category | null>(null);
  const [categoryDelete, setCategoryDelete] = useState<Category | null>(null);
  const [categoryError, setCategoryError] = useState('');
  const [categoryBusy, setCategoryBusy] = useState(false);
  const [rename, setRename] = useState<Book | null>(null);
  const [title, setTitle] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);
  const searchInput = useRef<HTMLInputElement>(null);
  const queryRef = useRef(query); queryRef.current = query;
  const loadSequence = useRef(0);
  const refresh = useCallback(async () => {
    const sequence = ++loadSequence.current;
    try {
      const value = await request<Library>('library', { query: queryRef.current });
      if (sequence !== loadSequence.current) return;
      setBooks(value.books); setCategories(value.categories);
    } catch (e) { if (sequence === loadSequence.current) setError(errorMessage(e)); }
    finally { if (sequence === loadSequence.current) setLoading(false); }
  }, []);
  useEffect(() => { setBrowser(!desktop()); const timer = setTimeout(() => { void refresh(); }, 150); return () => clearTimeout(timer); }, [query, refresh]);
  const doImport = useCallback(async () => {
    if (!desktop()) { fileInput.current?.click(); return; }
    setBusy(true); setError('');
    try { const result: ImportResult = await window.hondana!.importBooks(); await refresh(); if (result.errors.length) setError(result.errors.map(e => `${e.path.split(/[\\/]/).pop()}：${e.message}`).join('；')); }
    catch (e) { setError(errorMessage(e)); } finally { setBusy(false); }
  }, [refresh]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!event.metaKey && !event.ctrlKey) return;
      if (event.key.toLowerCase() === 'o') { event.preventDefault(); void doImport(); }
      if (event.key.toLowerCase() === 'k') { event.preventDefault(); searchInput.current?.focus(); }
    };
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey);
  }, [doImport]);
  async function mutate(operation: string, payload: Record<string, unknown>) {
    setError(''); try { await request(operation, payload); await refresh(); return true; } catch (e) { setError(errorMessage(e)); return false; }
  }
  function openCategory(category?: Category) {
    setCategoryError(''); setCategoryEdit(category || null); setCategoryInput(category?.name || '');
  }
  async function saveCategory() {
    if (categoryBusy || categoryInput === null) return;
    setCategoryBusy(true); setCategoryError('');
    try {
      await request(categoryEdit ? 'category:update' : 'category:create', { ...(categoryEdit ? { id: categoryEdit.id } : {}), name: categoryInput });
      await refresh(); setCategoryInput(null); setCategoryEdit(null);
    } catch (e) { setCategoryError(errorMessage(e)); }
    finally { setCategoryBusy(false); }
  }
  async function deleteCategory() {
    if (categoryBusy || !categoryDelete) return;
    setCategoryBusy(true); setCategoryError('');
    try {
      await request('category:delete', { id: categoryDelete.id });
      setFilter(current => current === categoryDelete.id ? 'all' : current);
      await refresh(); setCategoryDelete(null);
    } catch (e) { setCategoryError(errorMessage(e)); }
    finally { setCategoryBusy(false); }
  }
  const displayed = books.filter(b => filter === 'all' || (filter === 'reading' ? b.progress && b.progress.percent < 100 : b.categoryId === filter));
  const recent = [...displayed].filter(b => b.progress && b.progress.percent > 0).sort((a,b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''))[0];
  const activeName = filter === 'all' ? '全部图书' : filter === 'reading' ? '正在阅读' : categories.find(c => c.id === filter)?.name ?? '分类';
  if (reader) return <Reader book={reader} onBack={() => { setReader(null); void refresh(); }} />;
  return <main className="app-shell">
    <input ref={fileInput} type="file" accept=".md,.markdown" multiple hidden aria-label="导入 Markdown" onChange={async e => {
      if (!e.target.files) return; setBusy(true); setError('');
      try { const result = await importMarkdown(e.target.files); await refresh(); if (result.errors.length) setError(result.errors.map(e => e.message).join('；')); }
      catch (err) { setError(errorMessage(err)); } finally { setBusy(false); e.target.value = ''; }
    }} />
    <aside className={`sidebar ${sidebar ? '' : 'sidebar-collapsed'}`}>
      <div className="brand"><div className="brand-mark">h</div><span>hondana</span><span className="brand-dot">·</span><span className="brand-sub">Reader</span></div>
      <div className="sidebar-scroll">
        <button className="import-button" disabled={busy} onClick={() => void doImport()}>{busy ? <LoaderCircle size={17} className="spin" /> : <Upload size={17} />}<span>导入图书</span><kbd>⌘ O</kbd></button>
        <nav className="primary-nav"><button className={`nav-item ${filter === 'all' ? 'active' : ''}`} onClick={() => setFilter('all')}><Archive size={17} /> 我的书架 <span className="nav-count">{books.length}</span></button><button className={`nav-item ${filter === 'reading' ? 'active' : ''}`} onClick={() => setFilter('reading')}><BookOpen size={17} /> 正在阅读</button></nav>
        <div className="side-label"><span>我的分类</span><button title="新建分类" aria-label="新建分类" onClick={() => openCategory()}><Plus size={15} /></button></div>
        <nav className="collection-nav">{categories.map((category, i) => <div key={category.id} className="collection-entry"><button className={`collection ${filter === category.id ? 'active' : ''}`} onClick={() => setFilter(category.id)} onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); const id = e.dataTransfer.getData('application/hondana-book'); if (id) void mutate('book:update', { id, categoryId: category.id }); }}><span className={`collection-dot ${['dot-reading','dot-design','dot-notes'][i % 3]}`} /><span className="collection-name">{category.name}</span><span>{books.filter(b => b.categoryId === category.id).length}</span></button><div className="collection-actions"><button title={`编辑分类 ${category.name}`} aria-label={`编辑分类 ${category.name}`} onClick={() => openCategory(category)}><Pencil size={13} /></button><button title={`删除分类 ${category.name}`} aria-label={`删除分类 ${category.name}`} onClick={() => { setCategoryError(''); setCategoryDelete(category); }}><Trash2 size={13} /></button></div></div>)}</nav>
        {!categories.length && <p className="sidebar-hint">按主题整理你的书架。<br />点击 + 创建第一个分类。</p>}
        <div className="local-card"><span className="live-dot" /><strong>属于你的阅读空间</strong><p>{browser ? '浏览器预览 · 支持 Markdown，数据保存在本浏览器。' : '图书保留在本地，笔记与进度自动保存。'}</p></div>
      </div>
      <div className="sidebar-footer"><div className="brand-mark">h</div><div><div className="footer-title">hondana Reader</div><div className="footer-caption">版本 0.1.0 · 本地优先</div></div></div>
    </aside>
    <section className="library-main">
      <header className="topbar"><div className="topbar-left"><button className="icon-button" onClick={() => setSidebar(!sidebar)} aria-label="切换侧栏"><Menu size={19} /></button><div className="breadcrumbs"><span>书架</span><ChevronRight size={14} /><strong>{activeName}</strong></div></div><label className="search-box"><Search size={16} /><input ref={searchInput} aria-label="搜索书架" value={query} onChange={e => setQuery(e.target.value)} placeholder="搜索书名或作者" /><kbd>⌘ K</kbd></label></header>
      <div className="library-content">
        {error && <div role="alert" className="error-banner"><span>{error}</span><button className="icon-button" onClick={() => setError('')} aria-label="关闭错误"><X size={16} /></button></div>}
        <div className="library-heading"><div><p className="eyebrow">YOUR PERSONAL READING SPACE</p><h1>把时间，留给好书。</h1><p className="heading-copy">收藏值得重读的文字，记下此刻的想法。</p></div><button className="button primary" disabled={busy} onClick={() => void doImport()}><FilePlus2 size={17} /> 导入图书</button></div>
        {recent && <section className="continue-section"><div className="section-heading"><div><h2>继续阅读</h2><p>从上一次停下的地方开始。</p></div></div><button className="continue-card" onClick={() => setReader(recent)}><Cover book={recent} large /><div className="continue-info"><div className="book-kicker"><span className="status-dot" /> 正在阅读</div><h2>{recent.title}</h2><p className="author">{recent.author || recent.fileType.toUpperCase()}</p><div className="reading-progress"><div className="progress-line"><span style={{ width: `${recent.progress!.percent}%` }} /></div><div className="progress-label"><span>已读 {Math.round(recent.progress!.percent)}%</span></div></div><span className="button dark">继续阅读 <ArrowUpRight size={16} /></span></div></button></section>}
        <section className="library-section"><div className="section-heading"><div><h2>{activeName}</h2><p>{displayed.length} 本图书{query ? ` · 搜索 “${query}”` : ''}</p></div><div className="view-controls"><button className={`icon-button ${view === 'grid' ? 'selected' : ''}`} onClick={() => setView('grid')} aria-label="网格视图"><Grid2X2 size={16} /></button><button className={`icon-button ${view === 'list' ? 'selected' : ''}`} onClick={() => setView('list')} aria-label="列表视图"><List size={17} /></button><span className="control-divider" /><button className="button subtle" onClick={() => openCategory()}><FolderPlus size={16} /> 新建分类</button></div></div>
          {loading ? <div className="empty-state"><LoaderCircle className="spin" /><p>正在打开书架…</p></div> : !displayed.length ? <div className="empty-state"><BookOpen size={38} strokeWidth={1} /><h3>{query ? '还没有找到这本书' : filter === 'all' ? '一本好书，就是一个新的开始。' : '这里还没有图书'}</h3><p>{query ? '试试其他书名或作者。' : browser ? '导入 Markdown 开始阅读，桌面端支持 EPUB、PDF 与 Markdown。' : '导入 EPUB、PDF 或 Markdown，让书架慢慢生长。'}</p>{!query && filter === 'all' && <button className="button primary" onClick={() => void doImport()}><Plus size={16} /> 导入第一本书</button>}</div> : <div className={view === 'grid' ? 'book-grid' : 'book-list'}>{displayed.map(book => <article className="book-item" key={book.id} draggable onDragStart={e => e.dataTransfer.setData('application/hondana-book', book.id)} onContextMenu={e => { e.preventDefault(); setRename(book); setTitle(book.title); }}>
            <button className="book-open" onClick={() => setReader(book)} aria-label={`阅读 ${book.title}`}><Cover book={book} /><div className="book-item-info"><div className="book-item-title">{book.title}</div><div className="book-item-author">{book.author || '本地文档'}</div><div className="book-item-meta"><span className={`type-label type-${book.fileType}`}>{book.fileType.toUpperCase()}</span><span>{book.progress ? `已读 ${Math.round(book.progress.percent)}%` : '尚未阅读'}</span></div><div className="book-progress"><span style={{ width: `${book.progress?.percent || 0}%` }} /></div></div></button>
            <button className="book-manage" onClick={() => { setRename(book); setTitle(book.title); }} aria-label={`管理 ${book.title}`}>管理</button>
          </article>)}</div>}
        </section>
      </div><footer className="library-footer"><span><span className="live-dot" /> {browser ? '浏览器预览' : '本地书库'}</span><span>EPUB · PDF · Markdown</span><span className="footer-shortcuts">⌘ K 搜索 &nbsp;&nbsp; ⌘ O 导入</span></footer>
    </section>
    {categoryInput !== null && <div className="modal-backdrop"><form className="dialog-card" role="dialog" aria-modal="true" aria-labelledby="category-dialog-title" onSubmit={e => { e.preventDefault(); void saveCategory(); }}><h2 id="category-dialog-title">{categoryEdit ? '编辑分类' : '新建分类'}</h2><input autoFocus aria-label="分类名称" value={categoryInput} maxLength={80} disabled={categoryBusy} placeholder="例如：设计与生活" onChange={e => setCategoryInput(e.target.value)} />{categoryError && <p role="alert" className="dialog-error">{categoryError}</p>}<div className="dialog-actions"><button type="button" className="button subtle" disabled={categoryBusy} onClick={() => { setCategoryInput(null); setCategoryEdit(null); }}>取消</button><button className="button primary" disabled={categoryBusy || !categoryInput.trim()}>{categoryBusy ? '正在保存…' : categoryEdit ? '保存' : '创建'}</button></div></form></div>}
    {categoryDelete && <div className="modal-backdrop"><div className="dialog-card" role="dialog" aria-modal="true" aria-labelledby="category-delete-title"><h2 id="category-delete-title">删除分类</h2><p className="dialog-hint">确定删除“{categoryDelete.name}”吗？该分类下的图书会变为未分类，图书、笔记和阅读进度都会保留。</p>{categoryError && <p role="alert" className="dialog-error">{categoryError}</p>}<div className="dialog-actions"><button autoFocus type="button" className="button subtle" disabled={categoryBusy} onClick={() => setCategoryDelete(null)}>取消</button><button type="button" className="button danger" disabled={categoryBusy} onClick={() => void deleteCategory()}>{categoryBusy ? '正在删除…' : '删除分类'}</button></div></div></div>}
    {rename && <div className="modal-backdrop"><form className="dialog-card" onSubmit={async e => { e.preventDefault(); if (await mutate('book:update', { id: rename.id, title })) setRename(null); }}><h2>管理图书</h2><label>书名<input autoFocus aria-label="书名" value={title} onChange={e => setTitle(e.target.value)} /></label><label>分类<select aria-label="图书分类" value={rename.categoryId || ''} onChange={async e => { const categoryId = e.target.value || null; if (await mutate('book:update', { id: rename.id, categoryId })) setRename({ ...rename, categoryId }); }}><option value="">未分类</option>{categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label><p className="dialog-hint">移出书架会删除本书笔记和进度，原始文件会保留。</p><div className="dialog-actions"><button className="button danger" type="button" onClick={async () => { if (confirm(`将《${rename.title}》移出书架并删除本书笔记？`) && await mutate('book:remove', { id: rename.id })) setRename(null); }}>移出书架</button><button className="button subtle" type="button" onClick={() => setRename(null)}>关闭</button><button className="button primary" disabled={!title.trim()}>保存</button></div></form></div>}
  </main>;
}
