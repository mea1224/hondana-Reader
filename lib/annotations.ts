import type { Anchor, TextMark } from './types';
import { quoteRangeWithRuby } from './ruby-text';

export function readAnchor(value: string): Anchor | null {
  try { const parsed = JSON.parse(value) as Anchor; return typeof parsed.scope === 'string' ? parsed : null; } catch { return null; }
}
export function textAnchors(anchor: Anchor): TextMark[] {
  const primary = typeof anchor.start === 'number' && typeof anchor.end === 'number' && anchor.end > anchor.start
    ? [{ scope: anchor.scope, start: anchor.start, end: anchor.end, ...(anchor.quote ? { quote: anchor.quote } : {}), ...(anchor.displayQuote ? { displayQuote: anchor.displayQuote } : {}) }]
    : [];
  return [...primary, ...(anchor.textMarks || []).filter(mark => !!mark && typeof mark.scope === 'string' && Number.isFinite(mark.start) && Number.isFinite(mark.end) && mark.end > mark.start)];
}
export function addTextMark(anchor: Anchor, selected: Anchor): Anchor {
  if (selected.start === undefined || selected.end === undefined || selected.end <= selected.start) return anchor;
  const mark: TextMark = { scope: selected.scope, start: selected.start, end: selected.end, ...(selected.quote ? { quote: selected.quote } : {}), ...(selected.displayQuote ? { displayQuote: selected.displayQuote } : {}) };
  const existing = textAnchors(anchor);
  if (existing.some(item => item.scope === mark.scope && item.start === mark.start && item.end === mark.end)) return anchor;
  if (!existing.length) return { ...anchor, scope: mark.scope, start: mark.start, end: mark.end, ...(mark.quote ? { quote: mark.quote } : {}), ...(mark.displayQuote ? { displayQuote: mark.displayQuote } : {}) };
  return { ...anchor, textMarks: [...(anchor.textMarks || []), mark] };
}
export function expandRangeToRuby(range: Range, root: HTMLElement) {
  const rubyNodes = Array.from(root.querySelectorAll<HTMLElement>('ruby')).filter(ruby => range.intersectsNode(ruby));
  if (!rubyNodes.length) return;
  try {
    range.setStartBefore(rubyNodes[0]);
    range.setEndAfter(rubyNodes[rubyNodes.length - 1]);
  } catch {}
}
export function captureText(root: HTMLElement, scope: string): Anchor | null {
  const selection = window.getSelection();
  if (!selection?.rangeCount || selection.isCollapsed) return null;
  const range = selection.getRangeAt(0);
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return null;
  // Selecting a ruby base should capture its pronunciation too. Expand the
  // range to every ruby element it touches before calculating stable offsets.
  expandRangeToRuby(range, root);
  const before = range.cloneRange(); before.selectNodeContents(root); before.setEnd(range.startContainer, range.startOffset);
  return { scope, start: before.toString().length, end: before.toString().length + range.toString().length, quote: range.toString(), displayQuote: quoteRangeWithRuby(range) };
}
export function locateText(root: HTMLElement, anchor: Anchor): Range | null {
  if (anchor.start === undefined || anchor.end === undefined || anchor.end <= anchor.start) return null;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const full = root.textContent || '';
  let start = anchor.start; let end = anchor.end;
  if (anchor.quote && full.slice(start, end) !== anchor.quote) {
    const offset = full.indexOf(anchor.quote); if (offset < 0) return null; start = offset; end = offset + anchor.quote.length;
  }
  let position = 0;
  let first: { node: Node; offset: number } | null = null;
  let node: Node | null;
  while ((node = walker.nextNode())) {
    const size = node.textContent?.length || 0;
    if (!first && position + size > start) first = { node, offset: start - position };
    if (first && position + size >= end) {
      const range = document.createRange(); range.setStart(first.node, first.offset); range.setEnd(node, end - position); return range;
    }
    position += size;
  }
  return null;
}
