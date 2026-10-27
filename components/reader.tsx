'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, ChevronDown, ChevronRight, Download, ListTree, LoaderCircle, Paintbrush, PanelRight, Plus, Trash2, X } from 'lucide-react';
import { Markdown } from './markdown';
import { NoteEditor } from './note-editor';
import { addTextMark, captureText, expandRangeToRuby, locateText, readAnchor, textAnchors } from '../lib/annotations';
import { errorMessage, request } from '../lib/api';
import { formatNotesMarkdown, notesFilename } from '../lib/notes-export';
import { plainNoteText } from '../lib/note-format';
import { hasRubyText, quoteRangeWithRuby } from '../lib/ruby-text';
import { addImageStroke, undoImageStroke } from '../lib/image-annotations';
import { AnnotatedImage, ImageAnnotationContext } from './annotated-image';
import { RubyText } from './ruby-text';
import type { Anchor, Book, BookDocument, Chapter, ChapterAnchor, Color, ImageStroke, Location, Note, TocEntry } from '../lib/types';

const colors: Color[] = ['coral', 'yellow', 'blue', 'green'];
const colorNames: Record<Color, string> = { coral: '珊瑚红', yellow: '黄色', blue: '蓝色', green: '绿色' };
type Registry = Map<string, { add(range: Range): void }>;
const highlights = () => (CSS as unknown as { highlights?: Registry }).highlights;
type EpubSection = Chapter & { error?: string };

function Outline({ entries, navigate, active }: { entries: TocEntry[]; navigate: (href: string) => void; active: string }) {
  const [collapsed, setCollapsed] = useState<string[]>([]);
  return <div className="outline-tree">{entries.map((entry, i) => <div key={`${entry.href}-${i}`}><div className="outline-row">{entry.children.length ? <button className="tree-toggle" aria-label={`展开 ${entry.label}`} onClick={() => setCollapsed(current => current.includes(entry.href) ? current.filter(h => h !== entry.href) : [...current, entry.href])}>{collapsed.includes(entry.href) ? <ChevronRight size={13} /> : <ChevronDown size={13} />}</button> : <span className="tree-spacer" />}<button className={`outline-item ${entry.href.split('#')[0] === active ? 'active' : ''}`} onClick={() => navigate(entry.href)}>{entry.label}</button></div>{!collapsed.includes(entry.href) && !!entry.children.length && <Outline entries={entry.children} navigate={navigate} active={active} />}</div>)}</div>;
}
function PdfPage({ bookId, page, onImageNote }: { bookId: string; page: number; onImageNote: (anchor: Anchor) => void }) {
  const [src, setSrc] = useState('');
  const [error, setError] = useState('');
  const [visible, setVisible] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { const element = ref.current; if (!element) return; const observer = new IntersectionObserver(([entry]) => { setVisible(entry.isIntersecting); }, { rootMargin: '1000px' }); observer.observe(element); return () => observer.disconnect(); }, []);
  useEffect(() => {
    if (!visible) { setSrc(''); return; } let disposed = false; let objectUrl = '';
    void window.hondana?.renderPdf(bookId, page, 1200).then(bytes => {
      objectUrl = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: 'image/png' })); if (!disposed) setSrc(objectUrl); else URL.revokeObjectURL(objectUrl);
    }).catch(e => { if (!disposed) setError(errorMessage(e)); });
    return () => { disposed = true; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [bookId, page, visible]);
  return <div ref={ref} className="pdf-page" data-scope={`pdf/${page}`} id={`pdf-page-${page}`} onContextMenu={e => { e.preventDefault(); onImageNote({ scope: `pdf/${page}`, quote: `第 ${page + 1} 页`, rect: { x: 0, y: 0, width: 1, height: 1 } }); }}>
    {src ? <AnnotatedImage imageKey={`pdf-page-${page}`} scope={`pdf/${page}`} alt={`第 ${page + 1} 页`} src={src} onLoad={event => { const image = event.currentTarget; if (ref.current) ref.current.style.aspectRatio = `${image.naturalWidth} / ${image.naturalHeight}`; }} /> : <div className="pdf-placeholder">{error || <><LoaderCircle className="spin" size={20} />第 {page + 1} 页</>}</div>}<span className="pdf-page-number">{page + 1}</span>
  </div>;
}

export default function Reader({ book, onBack }: { book: Book; onBack: () => void }) {
  const [doc, setDoc] = useState<BookDocument | null>(null);
  const [body, setBody] = useState('');
  const [epubSections, setEpubSections] = useState<EpubSection[]>([]);
  const [chapterAnchors, setChapterAnchors] = useState<ChapterAnchor[]>([]);
  const [contentError, setContentError] = useState<{ message: string; href?: string } | null>(null);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [scope, setScope] = useState('document');
  const [notes, setNotes] = useState<Note[]>([]);
  const [legacyRubyQuotes, setLegacyRubyQuotes] = useState<Record<string, string[]>>({});
  const [activeNote, setActiveNote] = useState<string | null>(null);
  const [notesOpen, setNotesOpen] = useState(true);
  const [outlineOpen, setOutlineOpen] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [scale, setScale] = useState(100);
  const [anchor, setAnchor] = useState<Anchor | null>(null);
  const [selectionNoteId, setSelectionNoteId] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'highlights' | 'notes'>('all');
  const [progress, setProgress] = useState(book.progress?.percent || 0);
  const [page, setPage] = useState(1);
  const [saveStatus, setSaveStatus] = useState('已保存');
  const [markdownOutline, setMarkdownOutline] = useState<TocEntry[]>([]);
  const readingRef = useRef<HTMLElement>(null);
  const textRef = useRef<HTMLDivElement>(null);
  const docRef = useRef<BookDocument | null>(null);
  const scopeRef = useRef(scope); scopeRef.current = scope;
  const notesRef = useRef(notes); notesRef.current = notes;
  const sequence = useRef(0);
  const progressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingProgress = useRef<Location | null>(null);
  const saveTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const dirtyNotes = useRef(new Map<string, Note>());
  const savingNotes = useRef(new Map<string, Promise<void>>());
  const noteRanges = useRef(new Map<string, Range[]>());
  const noteLocationIndex = useRef(new Map<string, number>());
  const selectionCaptureFrame = useRef<number | null>(null);
  const pendingJump = useRef<Anchor | null>(null);
  const pendingFragment = useRef<string | null>(null);
  const selectionNoteIdRef = useRef<string | null>(null);
  const restoring = useRef(true);
  const allowClose = useRef(false);
  const report = useCallback((e: unknown) => setError(errorMessage(e)), []);

  const flushProgress = useCallback(() => {
    if (progressTimer.current) clearTimeout(progressTimer.current);
    const value = pendingProgress.current;
    if (!value) return Promise.resolve();
    return request('progress:save', { bookId: book.id, location: value }).then(() => { if (pendingProgress.current === value) pendingProgress.current = null; });
  }, [book.id, report]);
  const flushNote = useCallback((id: string) => {
    const timer = saveTimers.current.get(id); if (timer) clearTimeout(timer); saveTimers.current.delete(id);
    const previous = savingNotes.current.get(id);
    const save = (previous || Promise.resolve()).catch(() => {}).then(async () => {
      const note = dirtyNotes.current.get(id); if (!note) return;
      setSaveStatus('正在保存…');
      try {
        await request('note:save', { ...note });
        if (dirtyNotes.current.get(id) === note) dirtyNotes.current.delete(id);
        setSaveStatus(dirtyNotes.current.size ? '正在保存…' : '已保存');
      } catch (e) { setSaveStatus('保存失败，点击重试'); report(e); throw e; }
    });
    savingNotes.current.set(id, save);
    void save.catch(() => {});
    return save;
  }, [report]);
  useEffect(() => {
    let cancelled = false;
    let chapterPath: string | undefined;
    const requestId = ++sequence.current;
    setLoading(true); setError(''); setContentError(null); setDoc(null); setBody(''); setEpubSections([]); setChapterAnchors([]); restoring.current = true;
    docRef.current = null;
    void Promise.all([request<BookDocument>('book:open', { id: book.id }), request<Note[]>('notes:list', { bookId: book.id })]).then(async ([document, saved]) => {
      if (cancelled || requestId !== sequence.current) return; docRef.current = document; setDoc(document); setNotes(saved);
      if (document.kind === 'md') setBody(document.markdown || '');
      if (document.kind === 'epub') {
        const sections = await Promise.all(document.chapters.map(async chapterMeta => {
          try { return await request<Chapter>('chapter', { id: book.id, path: chapterMeta.path }); }
          catch (error) { return { path: chapterMeta.path, text: '', anchors: [], error: errorMessage(error) }; }
        }));
        if (cancelled || requestId !== sequence.current) return;
        setEpubSections(sections);
        const initial = sections.find(c => c.path === book.progress?.scope) || sections[0];
        chapterPath = initial?.path;
        if (initial) { setScope(initial.path); setBody(initial.text); setChapterAnchors(initial.anchors || []); }
      }
    }).catch(error => { if (!cancelled && requestId === sequence.current) { setContentError({ message: errorMessage(error), href: chapterPath }); report(error); } }).finally(() => { if (!cancelled && requestId === sequence.current) setLoading(false); });
    return () => { cancelled = true; ++sequence.current; };
  }, [book.id, report, book.progress?.scope, loadAttempt]);
  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (allowClose.current) return;
      if (window.hondana && (pendingProgress.current || dirtyNotes.current.size)) {
        event.preventDefault(); event.returnValue = '';
        void Promise.all([flushProgress(), ...[...dirtyNotes.current.keys()].map(flushNote)]).then(() => { allowClose.current = true; window.close(); }).catch(report);
      } else {
        void flushProgress().catch(report); for (const id of dirtyNotes.current.keys()) void flushNote(id);
      }
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => {
      window.removeEventListener('beforeunload', beforeUnload);
      if (selectionCaptureFrame.current !== null) cancelAnimationFrame(selectionCaptureFrame.current);
      void flushProgress().catch(report);
      for (const id of dirtyNotes.current.keys()) void flushNote(id);
    };
  }, [flushProgress, flushNote]);

  useEffect(() => {
    if (loading || doc?.kind !== 'md' || !textRef.current) return;
    setMarkdownOutline(Array.from(textRef.current.querySelectorAll('h1,h2,h3,h4,h5,h6')).map(element => ({ label: element.textContent || '', href: `#${element.id}`, children: [] })));
  }, [body, loading, doc]);

  const jumpToAnchor = useCallback((target: Anchor) => {
    const pdf = target.scope.startsWith('pdf/');
    const epub = docRef.current?.kind === 'epub';
    const root = textRef.current;
    const section = epub
      ? Array.from(root?.querySelectorAll<HTMLElement>('[data-epub-path]') || []).find(item => item.dataset.epubPath === target.scope) || null
      : null;
    const element = pdf ? document.getElementById(`pdf-page-${target.scope.split('/')[1]}`) : section || root;
    if (!element) return;
    const range = pdf ? null : locateText(element, target) || (section && root ? locateText(root, target) : null);
    if (range) (range.startContainer.parentElement || element).scrollIntoView({ behavior: 'smooth', block: 'center' });
    else element.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);
  const jumpToFragment = useCallback((fragment: string, path = scopeRef.current) => {
    let id = fragment; try { id = decodeURIComponent(fragment); } catch {}
    const root = textRef.current; if (!root) return;
    const section = Array.from(root.querySelectorAll<HTMLElement>('[data-epub-path]')).find(element => element.dataset.epubPath === path);
    const find = (container: HTMLElement) => Array.from(container.querySelectorAll<HTMLElement>('[data-epub-anchor]')).find(element => element.dataset.epubAnchor === id)
      || Array.from(container.querySelectorAll<HTMLElement>('[id]')).find(element => element.id === id);
    const target = (section && find(section)) || find(root) || section;
    target?.scrollIntoView({ block: 'start' });
  }, []);
  useEffect(() => {
    if (loading || !doc || contentError) return;
    const frame = requestAnimationFrame(() => {
      if (pendingJump.current) { jumpToAnchor(pendingJump.current); pendingJump.current = null; }
      else if (pendingFragment.current) { jumpToFragment(pendingFragment.current); pendingFragment.current = null; }
      else if (restoring.current && readingRef.current) {
        if (doc.kind === 'pdf' && book.progress?.scope.startsWith('pdf/')) document.getElementById(`pdf-page-${book.progress.scope.split('/')[1]}`)?.scrollIntoView();
        else if (doc.kind === 'epub' && book.progress?.scope) {
          const element = readingRef.current;
          const section = Array.from(element?.querySelectorAll<HTMLElement>('[data-epub-path]') || []).find(item => item.dataset.epubPath === book.progress?.scope);
          if (element && section) {
            const offset = section.getBoundingClientRect().top - element.getBoundingClientRect().top + element.scrollTop;
            element.scrollTop = offset + (book.progress?.ratio || 0) * Math.max(0, section.scrollHeight - element.clientHeight);
          }
        } else { const element = readingRef.current; element.scrollTop = (book.progress?.ratio || 0) * Math.max(0, element.scrollHeight - element.clientHeight); }
      }
      restoring.current = false;
      onScroll();
    });
    return () => cancelAnimationFrame(frame);
  }, [body, epubSections, loading, doc, book.progress, jumpToAnchor, jumpToFragment, contentError]);
  useEffect(() => {
    const registry = highlights(); const ranges = new Map<string, Range[]>();
    colors.forEach(color => registry?.delete(`note-${color}`));
    const HighlightCtor = (window as unknown as { Highlight?: new (...ranges: Range[]) => { add(range: Range): void } }).Highlight;
    if (registry && HighlightCtor && textRef.current) {
      for (const color of colors) {
        const highlight = new HighlightCtor();
        notes.filter(n => n.color === color).forEach(note => {
          const target = readAnchor(note.rangeLoc);
          if (!target) return;
          const root = textRef.current!;
          const epub = docRef.current?.kind === 'epub';
          const found: Range[] = [];
          textAnchors(target).forEach(mark => {
            if (!epub && mark.scope !== scope) return;
            const section = epub
              ? Array.from(root.querySelectorAll<HTMLElement>('[data-epub-path]')).find(item => item.dataset.epubPath === mark.scope) || null
              : null;
            const range = section ? locateText(section, mark) : !epub ? locateText(root, mark) : null;
            if (range) { found.push(range); highlight.add(range); }
          });
          if (found.length) ranges.set(note.id, found);
        });
        registry.set(`note-${color}`, highlight);
      }
    }
    noteRanges.current = ranges;
    return () => { colors.forEach(color => registry?.delete(`note-${color}`)); };
  }, [notes, body, epubSections, scope, loading, contentError]);

  // Old notes stored only Range.toString(), which flattens ruby base text and
  // its pronunciation. Re-read those ranges from the rendered EPUB when the
  // saved anchor predates displayQuote, so the note card can restore ruby.
  useEffect(() => {
    if (loading || doc?.kind !== 'epub' || !textRef.current) {
      setLegacyRubyQuotes({});
      return;
    }
    const root = textRef.current;
    const resolved: Record<string, string[]> = {};
    for (const note of notes) {
      const location = readAnchor(note.rangeLoc);
      if (!location) continue;
      const marks = textAnchors(location);
      const quotes = marks.map(mark => {
        if (mark.displayQuote && hasRubyText(mark.displayQuote)) return mark.displayQuote;
        const section = Array.from(root.querySelectorAll<HTMLElement>('[data-epub-path]')).find(item => item.dataset.epubPath === mark.scope);
        if (!section) return '';
        const range = locateText(section, mark);
        if (!range) return '';
        expandRangeToRuby(range, section);
        const quote = quoteRangeWithRuby(range);
        return hasRubyText(quote) ? quote : '';
      });
      if (quotes.some(Boolean)) resolved[note.id] = quotes;
    }
    setLegacyRubyQuotes(resolved);
  }, [doc?.kind, epubSections, loading, notes]);

  async function navigate(href: string, target?: Anchor) {
    const document = docRef.current; if (!document) return;
    void flushProgress().catch(report); setAnchor(null);
    const path = href.split('#')[0] || scopeRef.current;
    const fragment = href.includes('#') ? href.slice(href.indexOf('#') + 1) : '';
    if (document.kind === 'pdf') {
      const mark = target?.imageMarks?.[0];
      const number = mark?.scope.startsWith('pdf/') ? Number(mark.scope.split('/')[1]) : Number(path.split('/')[1]);
      window.document.getElementById(`pdf-page-${number}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }); return;
    }
    if (document.kind === 'md' || (document.kind === 'epub' && epubSections.some(section => section.path === path))) {
      if (document.kind === 'epub') setScope(path);
      if (target) jumpToAnchor(target);
      else if (fragment) jumpToFragment(fragment, path);
      else if (document.kind === 'epub') {
        textRef.current?.querySelector<HTMLElement>(`[data-epub-path="${CSS.escape(path)}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      } else if (readingRef.current) readingRef.current.scrollTop = 0;
      return;
    }
    if (!document.chapters.some(c => c.path === path)) {
      setContentError({ message: '目录链接指向不存在的章节，请检查 EPUB 的目录文件。', href });
      return;
    }
    const requestId = ++sequence.current; setLoading(true); setError(''); setContentError(null);
    try { const value = await request<Chapter>('chapter', { id: book.id, path }); if (requestId !== sequence.current) return; pendingJump.current = target || null; pendingFragment.current = fragment || null; setScope(path); setBody(value.text); setChapterAnchors(value.anchors || []); if (readingRef.current) readingRef.current.scrollTop = 0; }
    catch (e) { if (requestId === sequence.current) { setContentError({ message: errorMessage(e), href }); report(e); } } finally { if (requestId === sequence.current) setLoading(false); }
  }
  function onScroll() {
    const element = readingRef.current; if (!element || restoring.current || loading || !doc || contentError) return;
    const ratio = element.scrollHeight <= element.clientHeight ? 1 : element.scrollTop / Math.max(1, element.scrollHeight - element.clientHeight);
    let activeScope = scope; let current = doc.chapters.findIndex(c => c.path === scope) + 1;
    let percent = ratio * 100;
    if (doc.kind === 'epub') {
      const sections = Array.from(element.querySelectorAll<HTMLElement>('[data-epub-path]'));
      const rect = element.getBoundingClientRect();
      const active = sections.find(section => section.getBoundingClientRect().bottom > rect.top + 120) || sections[sections.length - 1];
      if (active?.dataset.epubPath) {
        activeScope = active.dataset.epubPath;
        current = doc.chapters.findIndex(chapter => chapter.path === activeScope) + 1;
        if (activeScope !== scopeRef.current) { scopeRef.current = activeScope; setScope(activeScope); }
        const sectionOffset = active.getBoundingClientRect().top - rect.top + element.scrollTop;
        const sectionScrollableHeight = Math.max(1, active.scrollHeight - element.clientHeight);
        const sectionRatio = Math.max(0, Math.min(1, (element.scrollTop - sectionOffset) / sectionScrollableHeight));
        percent = ((Math.max(0, current - 1) + sectionRatio) / Math.max(1, doc.chapters.length)) * 100;
      }
    }
    if (doc.kind === 'pdf') {
      const pages = Array.from(element.querySelectorAll<HTMLElement>('[data-scope]'));
      const rect = element.getBoundingClientRect(); const active = pages.find(p => p.getBoundingClientRect().bottom > rect.top + 100) || pages[pages.length - 1];
      activeScope = active?.dataset.scope || 'pdf/0'; current = Number(activeScope.split('/')[1]) + 1;
    }
    setPage(Math.max(1, current)); setProgress(Math.min(100, Math.max(0, percent)));
    let progressRatio = ratio;
    if (doc.kind === 'epub') {
      const section = Array.from(element.querySelectorAll<HTMLElement>('[data-epub-path]')).find(item => item.dataset.epubPath === activeScope);
      if (section) {
        const sectionOffset = section.getBoundingClientRect().top - element.getBoundingClientRect().top + element.scrollTop;
        progressRatio = Math.max(0, Math.min(1, (element.scrollTop - sectionOffset) / Math.max(1, section.scrollHeight - element.clientHeight)));
      }
    }
    pendingProgress.current = { scope: activeScope, ratio: progressRatio, percent: Math.min(100, Math.max(0, percent)), page: current };
    if (progressTimer.current) clearTimeout(progressTimer.current); progressTimer.current = setTimeout(() => { void flushProgress().catch(report); }, 1000);
  }
  async function createNote(color: Color = 'yellow', target = anchor) {
    const location = target || { scope, quote: '' };
    const note: Note = { id: crypto.randomUUID(), bookId: book.id, rangeLoc: JSON.stringify(location), selectedText: location.displayQuote || location.quote || '', color, content: '', updatedAt: new Date().toISOString() };
    try {
      await request('note:save', { ...note });
      setNotes(current => [note, ...current]); setActiveNote(note.id); setNotesOpen(true); setFilter('all'); setAnchor(null); window.getSelection()?.removeAllRanges();
      if (location.quote || location.scope.startsWith('pdf/')) activateImageDrawing(note);
    }
    catch (e) { report(e); }
  }
  function updateNote(note: Note, patch: Partial<Pick<Note, 'color' | 'content' | 'rangeLoc' | 'selectedText'>>) {
    const value = { ...(dirtyNotes.current.get(note.id) || notesRef.current.find(n => n.id === note.id) || note), ...patch, updatedAt: new Date().toISOString() };
    setNotes(current => current.map(n => n.id === note.id ? value : n)); dirtyNotes.current.set(note.id, value);
    const timer = saveTimers.current.get(note.id); if (timer) clearTimeout(timer);
    setSaveStatus('正在保存…'); saveTimers.current.set(note.id, setTimeout(() => flushNote(note.id), 400));
  }
  function armNoteHighlight(note: Note, color: Color) {
    if (anchor?.quote) {
      const existing = readAnchor(note.rangeLoc);
      updateNote(note, { color, rangeLoc: JSON.stringify(addTextMark(existing || { scope: anchor.scope }, anchor)), selectedText: anchor.displayQuote || anchor.quote || '' });
      activateImageDrawing({ ...note, color });
      return;
    }
    updateNote(note, { color });
    activateImageDrawing(note);
  }
  function activateImageDrawing(note: Note) {
    selectionNoteIdRef.current = note.id;
    setSelectionNoteId(note.id);
    setActiveNote(note.id);
    setNotesOpen(true);
    setFilter('all');
    setAnchor(null);
    window.getSelection()?.removeAllRanges();
  }
  function markImage(noteId: string, imageScope: string, imageKey: string, stroke: ImageStroke) {
    const note = dirtyNotes.current.get(noteId) || notesRef.current.find(item => item.id === noteId);
    if (!note) return;
    const location = readAnchor(note.rangeLoc) || { scope: imageScope };
    updateNote(note, { rangeLoc: JSON.stringify(addImageStroke(location, imageScope, imageKey, stroke)) });
    setActiveNote(noteId);
    setNotesOpen(true);
  }
  function undoLastImageStroke(note: Note) {
    const location = readAnchor(note.rangeLoc);
    if (!location?.imageMarks?.length) return;
    updateNote(note, { rangeLoc: JSON.stringify(undoImageStroke(location)) });
  }
  function cancelNoteHighlight() {
    selectionNoteIdRef.current = null;
    setSelectionNoteId(null);
  }
  function captureReadingSelection() {
    const root = textRef.current;
    if (!root) return;
    let selected: Anchor | null;
    if (doc?.kind === 'epub') {
      const selectionRoot = window.getSelection()?.anchorNode?.parentElement?.closest<HTMLElement>('[data-epub-path]');
      selected = captureText(selectionRoot || root, selectionRoot?.dataset.epubPath || scope);
    } else {
      selected = captureText(root, scope);
    }
    const noteId = selectionNoteIdRef.current;
    if (selected?.quote && noteId) {
      const note = dirtyNotes.current.get(noteId) || notesRef.current.find(item => item.id === noteId);
      if (note) {
        const existing = readAnchor(note.rangeLoc);
        updateNote(note, { rangeLoc: JSON.stringify(addTextMark(existing || { scope: selected.scope }, selected)), selectedText: selected.displayQuote || selected.quote });
      }
      setAnchor(null);
      window.getSelection()?.removeAllRanges();
    } else {
      setAnchor(selected);
    }
  }
  function scheduleReadingSelectionCapture() {
    if (selectionCaptureFrame.current !== null) cancelAnimationFrame(selectionCaptureFrame.current);
    selectionCaptureFrame.current = requestAnimationFrame(() => {
      selectionCaptureFrame.current = null;
      captureReadingSelection();
    });
  }
  async function removeNote(id: string) {
    if (selectionNoteIdRef.current === id) cancelNoteHighlight();
    noteLocationIndex.current.delete(id);
    const timer = saveTimers.current.get(id); if (timer) clearTimeout(timer); saveTimers.current.delete(id); dirtyNotes.current.delete(id);
    try { await savingNotes.current.get(id)?.catch(() => {}); await request('note:delete', { id }); setNotes(current => current.filter(n => n.id !== id)); if (activeNote === id) setActiveNote(null); }
    catch (e) { report(e); }
  }
  function focusNote(note: Note) {
    const target = readAnchor(note.rangeLoc); setActiveNote(note.id);
    const locations = target ? [
      ...textAnchors(target).map(anchor => ({ kind: 'text' as const, anchor })),
      ...(target.imageMarks || []).map(mark => ({ kind: 'image' as const, mark })),
    ] : [];
    const locationIndex = locations.length ? ((noteLocationIndex.current.get(note.id) ?? -1) + 1) % locations.length : -1;
    const location = locationIndex >= 0 ? locations[locationIndex] : undefined;
    if (locationIndex >= 0) noteLocationIndex.current.set(note.id, locationIndex);
    if (location?.kind === 'image') {
      const mark = location.mark;
      const image = document.querySelector<HTMLElement>(`[data-image-scope="${CSS.escape(mark.scope)}"][data-image-key="${CSS.escape(mark.imageKey)}"]`);
      if (image) { image.scrollIntoView({ behavior: 'smooth', block: 'center' }); return; }
      if (mark.scope.startsWith('pdf/')) { document.getElementById(`pdf-page-${mark.scope.split('/')[1]}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }); return; }
    }
    if (location?.kind === 'text') { void navigate(location.anchor.scope, location.anchor); return; }
    if (target) void navigate(target.scope, target);
  }
  const drawingNote = selectionNoteId ? notes.find(note => note.id === selectionNoteId) : null;
  const imageAnnotationContext = {
    notes,
    drawing: drawingNote ? { noteId: drawingNote.id, color: drawingNote.color } : null,
    onStroke: markImage,
    onSelect: (noteId: string) => setActiveNote(noteId),
  };
  const currentIndex = Math.max(0, doc?.chapters.findIndex(c => c.path === scope) ?? 0);
  const outline: TocEntry[] = doc?.kind === 'pdf' ? Array.from({ length: doc.pageCount }, (_, i) => ({ label: `第 ${i + 1} 页`, href: `pdf/${i}`, children: [] })) : doc?.kind === 'md' ? markdownOutline : doc?.toc || [];
  async function leave() {
    try { await flushProgress(); await Promise.all([...dirtyNotes.current.keys()].map(flushNote)); onBack(); } catch (e) { report(e); }
  }
  async function exportNotes() {
    const content = formatNotesMarkdown(book, notes);
    try {
      if (window.hondana) {
        const saved = await window.hondana.exportMarkdown(notesFilename(book.title), content);
        if (saved) setSaveStatus('笔记已导出');
      } else {
        const url = URL.createObjectURL(new Blob([content], { type: 'text/markdown;charset=utf-8' }));
        const link = window.document.createElement('a'); link.href = url; link.download = notesFilename(book.title);
        window.document.body.appendChild(link); link.click(); link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000); setSaveStatus('笔记已下载');
      }
    } catch (e) { report(e); }
  }
  const visibleNotes = notes.filter(note => filter === 'all' || (filter === 'highlights' ? !!note.selectedText || !!readAnchor(note.rangeLoc)?.imageMarks?.length || !!(readAnchor(note.rangeLoc) && textAnchors(readAnchor(note.rangeLoc)!).length) : !!plainNoteText(note.content).trim()));
      return <main className="reader-shell">
    <header className="reader-topbar"><div className="reader-left"><button className="icon-button" onClick={() => void leave()} aria-label="返回书架"><ArrowLeft size={18} /></button><div className="reader-book"><div className="mini-cover">{book.title.slice(0, 1)}</div><div><strong>{book.title}</strong><span>{book.author || book.fileType.toUpperCase()}</span></div></div></div><div className="reader-controls"><button className="icon-button" onClick={() => setOutlineOpen(!outlineOpen)} aria-label="切换目录"><ListTree size={17} /></button><button className="reader-control" onClick={() => setScale(v => Math.max(80, v - 10))} aria-label="缩小">A−</button><span className="reader-scale">{scale}%</span><button className="reader-control" onClick={() => setScale(v => Math.min(160, v + 10))} aria-label="放大">A+</button><span className="control-divider" /><button className="icon-button" onClick={() => setNotesOpen(!notesOpen)} aria-label="切换笔记"><PanelRight size={17} /></button></div></header>
    {error && <div role="alert" className="reader-alert"><span>{error}</span><button className="icon-button" onClick={() => setError('')} aria-label="关闭错误"><X size={15} /></button></div>}
    <div className="reader-layout">
      {outlineOpen && <aside className="outline-panel"><div className="panel-heading"><span>目录</span><button className="icon-button" onClick={() => setOutlineOpen(false)} aria-label="隐藏目录"><X size={15} /></button></div><div className="outline-progress"><div><span>阅读进度</span><strong>{Math.round(progress)}%</strong></div><div className="progress-line"><span style={{ width: `${progress}%` }} /></div></div><div className="outline-list">{outline.length ? <Outline entries={outline} navigate={href => void navigate(href)} active={scope} /> : <p className="sidebar-hint">Markdown 文档<br />自由滚动阅读。</p>}</div><div className="outline-bottom">{doc?.kind === 'pdf' ? `第 ${page} / ${doc.pageCount} 页` : doc?.kind === 'epub' ? `第 ${currentIndex + 1} / ${doc.chapters.length} 节` : `${Math.round(progress)}% 已读`}</div></aside>}
      <article ref={readingRef} className={`reading-canvas ${selectionNoteId ? 'reader-marking' : ''}`} onScroll={onScroll} onPointerUp={e => { if (!(e.target as HTMLElement).closest('.annotated-image')) scheduleReadingSelectionCapture(); }} onMouseUp={e => { if (!(e.target as HTMLElement).closest('.annotated-image')) scheduleReadingSelectionCapture(); }} onTouchEnd={e => { if (!(e.target as HTMLElement).closest('.annotated-image')) scheduleReadingSelectionCapture(); }} onMouseMove={e => {
        for (const [id, ranges] of noteRanges.current) { if (ranges.some(range => Array.from(range.getClientRects()).some(rect => e.clientX >= rect.left && e.clientX <= rect.right && e.clientY >= rect.top && e.clientY <= rect.bottom))) { setActiveNote(id); break; } }
      }}>
        <ImageAnnotationContext.Provider value={imageAnnotationContext}>
        <div className="reading-breadcrumb">{book.title} <ChevronRight size={13} /> {doc?.kind === 'epub' ? `第 ${currentIndex + 1} 节` : book.fileType.toUpperCase()}</div>
        {loading ? <div className="reader-loading"><LoaderCircle className="spin" /><span>正在解析正文…</span></div> : contentError ? <div role="alert" className="reader-error"><h2>{contentError.href ? "无法打开这一节" : "无法打开这本书"}</h2><p>{contentError.message}</p><button className="button subtle" onClick={() => contentError.href ? void navigate(contentError.href) : setLoadAttempt(value => value + 1)}>重试</button></div> : !doc ? <div className="reader-error"><h2>无法打开这本书</h2><p>{error || '请检查原始文件是否存在。'}</p><button className="button subtle" onClick={onBack}>返回书架</button></div> : doc.kind === 'pdf' ? <div className="pdf-pages" style={{ width: `${Math.min(98, scale * .8)}%` }}>{Array.from({ length: doc.pageCount }, (_, i) => <PdfPage key={i} bookId={book.id} page={i} onImageNote={target => void createNote('blue', target)} />)}</div> : doc.kind === 'epub' ? <div ref={textRef} className="article-content markdown-content epub-scroll-content" style={{ fontSize: `${16 * scale / 100}px` }}>{epubSections.map(section => <section key={section.path} data-epub-path={section.path} className="epub-chapter"><Markdown text={section.text} anchors={section.anchors || []} resourceBookId={book.id} imageScope={section.path} />{section.error && <div role="alert" className="reader-inline-error"><strong>本节无法解析</strong><span>{section.error}</span></div>}</section>)}</div> : <div ref={textRef} className="article-content markdown-content" style={{ fontSize: `${16 * scale / 100}px` }}><Markdown text={body} anchors={chapterAnchors} /></div>}
        <div className="reader-page-footer"><span>{book.fileType.toUpperCase()}</span><span>{Math.round(progress)}% 已读</span></div>
        </ImageAnnotationContext.Provider>
      </article>
      {notesOpen && <aside className="notes-panel" onContextMenu={e => { if (!(e.target as HTMLElement).closest('.note-card')) { e.preventDefault(); void createNote('yellow', null); } }}><div className="notes-header"><div><span className="panel-eyebrow">笔记与高亮</span><h2>{notes.length} 条记录</h2></div><div className="notes-header-actions"><button className="icon-button" onClick={() => void exportNotes()} aria-label="导出笔记为 Markdown" title="导出 Markdown"><Download size={16} /></button><button className="icon-button" onClick={() => void createNote()} aria-label="新建笔记"><Plus size={17} /></button></div></div>{selectionNoteId && <div className="note-selection-mode" role="status"><span>拖选文字可继续添加高亮，也可跨图片或跨页涂抹</span><button onClick={cancelNoteHighlight}>完成</button></div>}<div className="notes-filter">{([['all','全部'],['highlights','高亮'],['notes','笔记']] as const).map(([value, label]) => <button key={value} className={filter === value ? 'filter-active' : ''} onClick={() => setFilter(value)}>{label}</button>)}</div><div className="notes-list">{!visibleNotes.length && <p className="notes-hint">选择颜色后可标记正文，<br />也可直接在图片上涂抹。</p>}{visibleNotes.map(note => { const location = readAnchor(note.rangeLoc); const marks = location?.imageMarks || []; const textMarks = location ? textAnchors(location) : []; const markCount = marks.reduce((total, item) => total + item.strokes.length, 0); const locationCount = marks.length + textMarks.length; const quotes = textMarks.map((mark, index) => mark.displayQuote || legacyRubyQuotes[note.id]?.[index] || mark.quote).filter((quote): quote is string => !!quote); return <div className={`note-card note-${note.color} ${activeNote === note.id ? 'active' : ''}`} key={note.id} onDoubleClick={() => focusNote(note)} onClick={() => setActiveNote(note.id)}><div className="note-card-top"><button className="note-locate" onClick={event => { event.stopPropagation(); focusNote(note); }}>{locationCount ? `定位标记 · ${locationCount} 处 ↗` : '定位原文 ↗'}</button><button className={`note-draw ${selectionNoteId === note.id ? 'active' : ''}`} aria-label="继续使用此笔记标记文字或图片" title="继续使用此笔记标记文字或图片" onClick={event => { event.stopPropagation(); activateImageDrawing(note); }}><Paintbrush size={13} /><span>{selectionNoteId === note.id ? '标记中' : '继续标记'}</span></button><span>{new Date(note.updatedAt).toLocaleDateString('zh-CN')}</span></div>{(quotes.length ? quotes : note.selectedText ? [note.selectedText] : []).map((quote, index) => <p className="note-quote" key={`${note.id}-quote-${index}`}>“<RubyText text={quote} />”</p>)}{markCount > 0 && <p className="image-mark-label">图片涂抹标记 · {markCount} 笔 / {marks.length} 处</p>}<NoteEditor value={note.content} onChange={content => updateNote(note, { content })} onBlur={() => flushNote(note.id)} /><div className="note-card-bottom"><div className="color-options">{colors.map(color => <button key={color} className={`color-swatch swatch-${color} ${note.color === color ? 'chosen' : ''} ${selectionNoteId === note.id && note.color === color ? 'drawing' : ''}`} aria-label={`选择${colorNames[color]}并标记`} aria-pressed={note.color === color} title={`选择${colorNames[color]}后可拖选正文或在图片上涂抹`} onMouseDown={event => event.preventDefault()} onClick={() => armNoteHighlight(note, color)} />)}</div>{markCount > 0 && <button className="undo-image-mark" aria-label="撤销最近的图片标记" title="撤销最近的图片标记" onClick={() => undoLastImageStroke(note)}>↶</button>}<button aria-label="删除笔记" onClick={() => void removeNote(note.id)}><Trash2 size={13} /></button></div></div>; })}</div><button className="add-note-button" onClick={() => void createNote()}><Plus size={16} /> 添加笔记</button><button className="save-status" onClick={() => { for (const id of dirtyNotes.current.keys()) flushNote(id); }}>{saveStatus}</button></aside>}
    </div>
    {anchor?.quote && <div className="selection-toolbar" role="toolbar" aria-label="添加高亮"><span>记录这段文字</span>{colors.map(color => <button key={color} className={`color-swatch swatch-${color}`} aria-label={`高亮 ${color}`} onMouseDown={e => e.preventDefault()} onClick={() => void createNote(color)} />)}<button className="icon-button" aria-label="取消选择" onClick={() => setAnchor(null)}><X size={14} /></button></div>}
  </main>;
}
