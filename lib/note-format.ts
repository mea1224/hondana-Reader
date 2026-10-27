export const RICH_NOTE_PREFIX = 'hondana-rich-v1:';

export const noteTextColors = [
  { name: '默认色', value: '#3a3835' },
  { name: '珊瑚红', value: '#c34f3c' },
  { name: '蓝色', value: '#3f65aa' },
  { name: '绿色', value: '#347657' },
  { name: '紫色', value: '#8054a6' },
] as const;

const allowedColors = new Set<string>(noteTextColors.map(color => color.value));

function escapeHtml(value: string) {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function safeColor(value: string | null | undefined) {
  const color = value?.trim().toLowerCase();
  if (!color) return null;
  if (allowedColors.has(color)) return color;
  const rgb = color.match(/^rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)$/);
  if (!rgb) return null;
  const hex = `#${rgb.slice(1).map(channel => Number(channel).toString(16).padStart(2, '0')).join('')}`;
  return allowedColors.has(hex) ? hex : null;
}

function serializeChildren(parent: ParentNode): string {
  let output = '';
  for (const node of Array.from(parent.childNodes)) {
    if (node.nodeType === Node.TEXT_NODE) { output += escapeHtml(node.textContent || ''); continue; }
    if (node.nodeType !== Node.ELEMENT_NODE) continue;
    const element = node as HTMLElement;
    const name = element.tagName.toLowerCase();
    if (name === 'br') { output += '<br>'; continue; }
    const inner = serializeChildren(element);
    if (name === 'div' || name === 'p') {
      if (output && !output.endsWith('<br>')) output += '<br>';
      output += inner;
    } else if (name === 'strong' || name === 'b') output += `<strong>${inner}</strong>`;
    else if (name === 'u') output += `<u>${inner}</u>`;
    else if (name === 'span' || name === 'font') {
      const color = safeColor(element.style.color || element.getAttribute('color'));
      output += color ? `<span style="color:${color}">${inner}</span>` : inner;
    } else output += inner;
  }
  return output.replace(/(?:<br>)+$/g, '');
}

export function serializeRichNote(root: HTMLElement) {
  return RICH_NOTE_PREFIX + serializeChildren(root);
}

export function decodeRichNote(value: string) {
  const template = document.createElement('template');
  if (value.startsWith(RICH_NOTE_PREFIX)) template.innerHTML = value.slice(RICH_NOTE_PREFIX.length);
  else {
    const lines = value.split(/\r?\n/);
    lines.forEach((line, index) => {
      if (index) template.content.append(document.createElement('br'));
      template.content.append(document.createTextNode(line));
    });
  }
  return serializeChildren(template.content);
}

export function plainNoteText(value: string) {
  if (!value.startsWith(RICH_NOTE_PREFIX)) return value;
  return value.slice(RICH_NOTE_PREFIX.length)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(?:div|p)>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}
