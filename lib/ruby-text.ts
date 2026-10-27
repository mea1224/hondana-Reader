export type RubyTextPart = { type: 'text'; text: string } | { type: 'ruby'; base: string; reading: string };

const rubyMarkerPattern = /\u27e6r:([0-9a-f]+):([0-9a-f]+)\u27e7/gi;

function hex(value: string) {
  return Array.from(new TextEncoder().encode(value), byte => byte.toString(16).padStart(2, '0')).join('');
}

function unhex(value: string) {
  try {
    return decodeURIComponent((value.match(/../g) || []).map(pair => `%${pair}`).join(''));
  } catch {
    return '';
  }
}

export function encodeRubyMarker(base: string, reading: string) {
  return `⟦r:${hex(base)}:${hex(reading)}⟧`;
}

export function rubyTextParts(value: string): RubyTextPart[] {
  const parts: RubyTextPart[] = [];
  let cursor = 0;
  for (const match of value.matchAll(rubyMarkerPattern)) {
    const index = match.index ?? 0;
    if (index > cursor) parts.push({ type: 'text', text: value.slice(cursor, index) });
    parts.push({ type: 'ruby', base: unhex(match[1]), reading: unhex(match[2]) });
    cursor = index + match[0].length;
  }
  if (cursor < value.length) parts.push({ type: 'text', text: value.slice(cursor) });
  return parts;
}

export function hasRubyText(value: string) {
  return rubyTextParts(value).some(part => part.type === 'ruby');
}

export function rubyTextToPlain(value: string) {
  return rubyTextParts(value).map(part => part.type === 'ruby' ? `${part.base}（${part.reading}）` : part.text).join('');
}

function textOutsideAnnotations(node: Node): string {
  if (node.nodeType === 3) return node.nodeValue || '';
  if (node.nodeType !== 1 && node.nodeType !== 11) return '';
  const element = node.nodeType === 1 ? node as Element : null;
  const tag = element?.tagName.toLowerCase();
  if (tag === 'rt' || tag === 'rtc' || tag === 'rp') return '';
  if (tag === 'br') return '\n';
  return Array.from(node.childNodes).map(textOutsideAnnotations).join('');
}

function annotationReadings(node: Node, readings: string[]) {
  if (node.nodeType === 1 && (node as Element).tagName.toLowerCase() === 'rt') {
    const reading = textOutsideAnnotations(node).trim();
    if (reading) readings.push(reading);
    return;
  }
  for (const child of Array.from(node.childNodes)) annotationReadings(child, readings);
}

function quoteNode(node: Node): string {
  if (node.nodeType === 3) return node.nodeValue || '';
  if (node.nodeType !== 1 && node.nodeType !== 11) return '';
  const element = node.nodeType === 1 ? node as Element : null;
  if (element?.tagName.toLowerCase() === 'ruby') {
    const base = Array.from(node.childNodes).map(textOutsideAnnotations).join('').trim();
    const readings: string[] = [];
    annotationReadings(node, readings);
    const reading = readings.join('・');
    return base && reading ? encodeRubyMarker(base, reading) : base || reading;
  }
  if (element?.tagName.toLowerCase() === 'br') return '\n';
  return Array.from(node.childNodes).map(quoteNode).join('');
}

export function quoteRangeWithRuby(range: Range) {
  return quoteNode(range.cloneContents());
}
