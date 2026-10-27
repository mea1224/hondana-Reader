import type { Book, BookDocument, Category, ImportResult, Library, Note } from './types';

type PreviewData = Library & { notes: Note[]; documents: Record<string, string> };
const key = 'hondana-browser-library-v1';
function read(): PreviewData {
  const raw = localStorage.getItem(key);
  return raw ? JSON.parse(raw) : { books: [], categories: [], notes: [], documents: {} };
}
function write(data: PreviewData) { localStorage.setItem(key, JSON.stringify(data)); }
export function desktop() { return typeof window !== 'undefined' && !!window.hondana; }
export async function request<T>(operation: string, payload: Record<string, unknown> = {}): Promise<T> {
  if (window.hondana) return await window.hondana.dispatch(operation, payload) as T;
  const data = read();
  let result: unknown;
  const book = data.books.find(b => b.id === (payload.bookId || payload.id));
  switch (operation) {
    case 'library': {
      const query = typeof payload.query === 'string' ? payload.query.trim().toLocaleLowerCase() : '';
      result = { books: data.books.filter(b => !query || `${b.title} ${b.author}`.toLocaleLowerCase().includes(query)), categories: data.categories };
      break;
    }
    case 'book:open':
      if (!book || data.documents[book.id] === undefined) throw new Error('找不到本地文档');
      result = { kind: 'md', markdown: data.documents[book.id], toc: [], chapters: [], pageCount: 1 } satisfies BookDocument; break;
    case 'category:create': {
      const name = typeof payload.name === 'string' ? payload.name.trim() : '';
      if (!name || name.length > 80) throw new Error('分类名称须为 1–80 个字符');
      if (data.categories.some(c => c.name === name)) throw new Error('分类已存在');
      const category: Category = { id: crypto.randomUUID(), name }; data.categories.push(category); result = category; break;
    }
    case 'category:update': {
      const category = data.categories.find(c => c.id === payload.id);
      if (!category) throw new Error('找不到分类');
      const name = typeof payload.name === 'string' ? payload.name.trim() : '';
      if (!name || name.length > 80) throw new Error('分类名称须为 1–80 个字符');
      if (data.categories.some(c => c.id !== category.id && c.name === name)) throw new Error('分类已存在');
      category.name = name; result = category; break;
    }
    case 'category:delete': {
      const category = data.categories.find(c => c.id === payload.id);
      if (!category) throw new Error('找不到分类');
      data.books.forEach(item => { if (item.categoryId === category.id) item.categoryId = null; });
      data.categories = data.categories.filter(c => c.id !== category.id); result = { ok: true }; break;
    }
    case 'book:update':
      if (!book) throw new Error('找不到图书');
      if (payload.title !== undefined) { if (!String(payload.title).trim()) throw new Error('书名不能为空'); book.title = String(payload.title).trim(); }
      if ('categoryId' in payload) {
        const categoryId = payload.categoryId === null || payload.categoryId === '' ? null : String(payload.categoryId);
        if (categoryId && !data.categories.some(category => category.id === categoryId)) throw new Error('找不到分类');
        book.categoryId = categoryId;
      }
      result = book; break;
    case 'book:remove':
      data.books = data.books.filter(b => b.id !== payload.id); data.notes = data.notes.filter(n => n.bookId !== payload.id); delete data.documents[String(payload.id)]; result = { ok: true }; break;
    case 'progress:save':
      if (!book) throw new Error('找不到图书'); book.progress = payload.location as Book['progress']; book.updatedAt = new Date().toISOString(); result = { ok: true }; break;
    case 'notes:list': result = data.notes.filter(n => n.bookId === payload.bookId).sort((a,b) => b.updatedAt.localeCompare(a.updatedAt)); break;
    case 'note:save': {
      if (!book) throw new Error('找不到图书');
      if (!['coral', 'yellow', 'blue', 'green'].includes(String(payload.color))) throw new Error('无效标记颜色');
      if (!payload.id || !payload.bookId || payload.bookId !== book.id) throw new Error('笔记不属于此图书');
      const previous = data.notes.find(note => note.id === payload.id);
      if (previous && previous.bookId !== book.id) throw new Error('笔记不属于此图书');
      const note = { ...payload, updatedAt: new Date().toISOString() } as Note;
      data.notes = [note, ...data.notes.filter(n => n.id !== note.id)]; result = { ok: true }; break;
    }
    case 'note:delete': data.notes = data.notes.filter(n => n.id !== payload.id); result = { ok: true }; break;
    default: throw new Error('此功能需要 Electron 桌面端');
  }
  if (operation !== 'library' && operation !== 'book:open' && operation !== 'notes:list') write(data);
  return result as T;
}
export async function importMarkdown(files: FileList | File[]): Promise<ImportResult> {
  const data = read();
  const result: ImportResult = { ids: [], errors: [] };
  for (const file of Array.from(files)) {
    try {
      if (!/\.(md|markdown)$/i.test(file.name)) throw new Error('浏览器预览支持 Markdown；EPUB / PDF 请使用桌面端');
      if (file.size > 32 * 1024 * 1024) throw new Error('文件超过 32 MB 限制');
      const markdown = await file.text();
      const existing = data.books.find(book => book.fileType === 'md' && book.filePath === file.name && data.documents[book.id] === markdown);
      if (existing) { result.ids.push(existing.id); continue; }
      const id = crypto.randomUUID();
      data.books.unshift({ id, title: file.name.replace(/\.(md|markdown)$/i,''), author: '', fileType: 'md', filePath: file.name, coverPath: null, categoryId: null, createdAt: new Date().toISOString(), updatedAt: null, progress: null });
      data.documents[id] = markdown; result.ids.push(id);
    } catch (e) { result.errors.push({ path: file.name, message: errorMessage(e) }); }
  }
  write(data); return result;
}
export function errorMessage(error: unknown) { return error instanceof Error ? error.message : String(error); }
export function openExternal(url: string) {
  if (!/^https?:\/\//i.test(url)) return;
  if (window.hondana) void window.hondana.openExternal(url);
  else window.open(url, '_blank', 'noopener,noreferrer');
}
export function resourceUrl(bookId: string, path: string) { return `hondana-resource://book/${bookId}/${path.split('/').map(encodeURIComponent).join('/')}`; }
