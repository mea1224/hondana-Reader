import type { Book, Note } from './types';
import { plainNoteText } from './note-format';
import { rubyTextToPlain } from './ruby-text';

const colorLabels: Record<Note['color'], string> = {
  coral: '珊瑚红', yellow: '黄色', blue: '蓝色', green: '绿色',
};

export function formatNotesMarkdown(book: Pick<Book, 'title' | 'author' | 'fileType'>, notes: Note[]) {
  const lines = [`# ${book.title.trim() || '未命名图书'}`, ''];
  if (book.author.trim()) lines.push(`作者：${book.author.trim()}`, '');
  lines.push(`来源格式：${book.fileType.toUpperCase()}`, '', `共 ${notes.length} 条笔记与高亮`, '', '---', '');
  for (const note of notes) {
    lines.push(`## ${new Date(note.updatedAt).toLocaleString('zh-CN')} · ${colorLabels[note.color] || '标记'}`, '');
    if (note.selectedText) lines.push('### 摘录', '', ...rubyTextToPlain(note.selectedText).split(/\r?\n/).map(line => `> ${line}`), '');
    const content = plainNoteText(note.content).trim();
    if (content) lines.push('### 笔记', '', content, '');
    try {
      const location = JSON.parse(note.rangeLoc) as { scope?: unknown };
      if (typeof location.scope === 'string' && location.scope) lines.push(`位置：${location.scope}`, '');
    } catch {}
    lines.push('---', '');
  }
  if (!notes.length) lines.push('暂无笔记。');
  return `${lines.join('\n').trimEnd()}\n`;
}

export function notesFilename(title: string) {
  const safeTitle = title.replace(/[\u0000-\u001f<>:"/\\|?*]/g, '-').trim().replace(/[. ]+$/g, '') || '未命名图书';
  return `${safeTitle}-笔记.md`;
}
