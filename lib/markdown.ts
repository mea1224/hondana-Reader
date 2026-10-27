import type { ChapterAnchor } from './types';

type Element = { type: string; tagName?: string; value?: string; properties?: Record<string, unknown>; children?: Element[]; position?: { start: { line: number } } };

const RUBY_MARKER = /\u27e6r:([0-9a-f]+):([0-9a-f]+)\u27e7/gi;

function decodeHex(value: string): string {
  try {
    return decodeURIComponent((value.match(/../g) || []).map(pair => `%${pair}`).join(''));
  } catch {
    return '';
  }
}

// EPUB parsing keeps ruby text as a private marker so the untrusted source is
// never inserted as HTML. Rebuild only these generated semantic elements.
export function rubyAnnotations() {
  return (tree: Element) => {
    const visit = (node: Element) => {
      if (!node.children?.length) return;
      node.children = node.children.flatMap(child => {
        visit(child);
        if (child.type !== 'text' || !child.value || !RUBY_MARKER.test(child.value)) return [child];
        RUBY_MARKER.lastIndex = 0;
        const result: Element[] = [];
        let cursor = 0;
        for (const match of child.value.matchAll(RUBY_MARKER)) {
          const start = match.index ?? 0;
          if (start > cursor) result.push({ type: 'text', value: child.value.slice(cursor, start) });
          result.push({
            type: 'element',
            tagName: 'ruby',
            properties: {},
            children: [
              { type: 'element', tagName: 'rb', properties: {}, children: [{ type: 'text', value: decodeHex(match[1]) }] },
              { type: 'element', tagName: 'rt', properties: {}, children: [{ type: 'text', value: decodeHex(match[2]) }] },
            ],
          });
          cursor = start + match[0].length;
        }
        if (cursor < child.value.length) result.push({ type: 'text', value: child.value.slice(cursor) });
        return result;
      });
    };
    visit(tree);
  };
}

// Insert DOM anchors without trusting or rendering the EPUB's original HTML.
export function epubAnchors(options: { anchors: ChapterAnchor[] }) {
  return (tree: Element) => {
    const lines = new Map<number, Element>();
    const index = (node: Element) => {
      const line = node.position?.start.line;
      if (node.type === 'element' && line !== undefined && !lines.has(line)) lines.set(line, node);
      node.children?.forEach(index);
    };
    index(tree);
    const blocks: Element[] = [];
    const blockTags = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'li', 'blockquote', 'pre']);
    const collectBlocks = (node: Element, insideBlock = false) => {
      const isBlock = node.type === 'element' && blockTags.has(node.tagName || '');
      if (isBlock && !insideBlock) {
        insideBlock = true;
        blocks.push(node);
      }
      node.children?.forEach(child => collectBlocks(child, insideBlock));
    };
    collectBlocks(tree);
    const targets = new Map<Element, Element[]>();
    for (const anchor of options.anchors) {
      // Markdown can merge adjacent quotes and list items. Source lines locate
      // their nested blocks, while block numbers support older native modules.
      const node = anchor.line === undefined ? blocks[anchor.block] : lines.get(anchor.line);
      if (!node) continue;
      const markers = targets.get(node) || [];
      markers.push({ type: 'element', tagName: 'span', properties: { 'data-epub-anchor': anchor.id, 'aria-hidden': 'true' }, children: [] });
      targets.set(node, markers);
    }
    const insert = (node: Element) => {
      node.children = node.children?.flatMap(child => {
        insert(child);
        return [...(targets.get(child) || []), child];
      });
    };
    insert(tree);
  };
}

// Assign stable heading IDs after Markdown has been parsed, including setext headings.
export function headingIds() {
  return (tree: Element) => {
    const counts = new Map<string, number>();
    const content = (node: Element): string => {
      if (node.tagName === 'ruby') {
        const base = node.children?.find(child => child.tagName === 'rb');
        return base ? content(base) : (node.children || []).filter(child => child.tagName !== 'rt').map(content).join('');
      }
      return node.value || (node.children || []).map(content).join('');
    };
    const visit = (node: Element) => {
      if (/^h[1-6]$/.test(node.tagName || '')) {
        const base = content(node).toLowerCase().trim().replace(/[^\p{L}\p{N}\s_-]/gu, '').replace(/\s+/g, '-') || 'heading';
        const count = counts.get(base) || 0; counts.set(base, count + 1);
        node.properties = { ...node.properties, id: count ? `${base}-${count}` : base };
      }
      node.children?.forEach(visit);
    };
    visit(tree);
  };
}
