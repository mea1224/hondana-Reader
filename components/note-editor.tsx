'use client';
import { useEffect, useRef, useState } from 'react';
import { Bold, Underline } from 'lucide-react';
import { decodeRichNote, noteTextColors, serializeRichNote } from '../lib/note-format';
import type { CSSProperties } from 'react';

export function NoteEditor({ value, onChange, onBlur }: { value: string; onChange: (value: string) => void; onBlur: () => void }) {
  const editor = useRef<HTMLDivElement>(null);
  const [activeFormats, setActiveFormats] = useState({ bold: false, underline: false });
  useEffect(() => {
    const element = editor.current;
    if (!element || document.activeElement === element) return;
    if (serializeRichNote(element) !== value) element.innerHTML = decodeRichNote(value);
  }, [value]);

  useEffect(() => {
    function updateActiveFormats() {
      const element = editor.current;
      const selection = document.getSelection();
      if (!element || !selection?.anchorNode || !element.contains(selection.anchorNode)) {
        setActiveFormats({ bold: false, underline: false });
        return;
      }
      setActiveFormats({ bold: document.queryCommandState('bold'), underline: document.queryCommandState('underline') });
    }
    document.addEventListener('selectionchange', updateActiveFormats);
    return () => document.removeEventListener('selectionchange', updateActiveFormats);
  }, []);

  function apply(command: 'bold' | 'underline' | 'foreColor', argument?: string) {
    editor.current?.focus();
    document.execCommand(command, false, argument);
    if (editor.current) onChange(serializeRichNote(editor.current));
    if (command === 'bold' || command === 'underline') {
      setActiveFormats(current => ({ ...current, [command]: document.queryCommandState(command) }));
    }
  }

  return <div className="note-writing">
    <div className="note-format-toolbar" role="toolbar" aria-label="笔记文字格式">
      <button type="button" className={`note-format-button ${activeFormats.bold ? 'active' : ''}`} aria-label="加粗" title="加粗" aria-pressed={activeFormats.bold} onMouseDown={event => event.preventDefault()} onClick={() => apply('bold')}><Bold size={14} /></button>
      <button type="button" className={`note-format-button ${activeFormats.underline ? 'active' : ''}`} aria-label="下划线" title="下划线" aria-pressed={activeFormats.underline} onMouseDown={event => event.preventDefault()} onClick={() => apply('underline')}><Underline size={14} /></button>
      <span className="note-format-divider" />
      {noteTextColors.map(color => <button key={color.value} type="button" className={`note-text-color ${color.value === '#3a3835' ? 'note-text-default' : ''}`} style={{ '--note-text-color': color.value } as CSSProperties} aria-label={`文字颜色：${color.name}`} title={`文字颜色：${color.name}`} onMouseDown={event => event.preventDefault()} onClick={() => apply('foreColor', color.value)}><span /></button>)}
    </div>
    <div ref={editor} className="note-text-editor" role="textbox" aria-label="笔记内容" aria-multiline="true" contentEditable suppressContentEditableWarning data-placeholder="写下你的想法…" onInput={event => onChange(serializeRichNote(event.currentTarget))} onBlur={onBlur} />
  </div>;
}
