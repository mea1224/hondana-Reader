import type { Anchor, ImagePoint, ImageStroke } from './types';

export const imageColors = { coral: '#e57358', yellow: '#edc83e', blue: '#608ee2', green: '#52aa74' };
export const imageOpacity = 0.32;
export const defaultBrushWidth = 0.018;

// Coordinates and brush widths are fractions of the image, independent of zoom.
export function imagePoint(clientX: number, clientY: number, rect: Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>): ImagePoint {
  const clamp = (value: number) => Math.round(Math.max(0, Math.min(1, value)) * 100000) / 100000;
  return { x: clamp((clientX - rect.left) / Math.max(1, rect.width)), y: clamp((clientY - rect.top) / Math.max(1, rect.height)) };
}

export function addImageStroke(anchor: Anchor, scope: string, imageKey: string, stroke: ImageStroke): Anchor {
  const marks = anchor.imageMarks || [];
  const previous = marks.find(mark => mark.scope === scope && mark.imageKey === imageKey);
  return { ...anchor, imageMarks: [...marks.filter(mark => mark !== previous), { scope, imageKey, strokes: [...(previous?.strokes || []), stroke] }] };
}

export function undoImageStroke(anchor: Anchor): Anchor {
  const marks = [...(anchor.imageMarks || [])];
  const index = marks.length - 1;
  const last = marks[index];
  if (!last) return anchor;
  if (last.strokes.length > 1) marks[index] = { ...last, strokes: last.strokes.slice(0, -1) };
  else marks.pop();
  return { ...anchor, imageMarks: marks };
}

export function strokePath(points: ImagePoint[], width: number, height: number, brushWidth = defaultBrushWidth) {
  if (!points.length) return '';
  const path = points.map((point, index) => `${index ? 'L' : 'M'}${point.x * width} ${point.y * height}`).join(' ');
  return points.length === 1 ? `${path} l${brushWidth * Math.min(width, height)} 0` : path;
}
