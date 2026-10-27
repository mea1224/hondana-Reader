'use client';
import { createContext, useContext, useEffect, useRef, useState } from 'react';
import type { ImgHTMLAttributes, MouseEvent, PointerEvent, TouchEvent } from 'react';
import { readAnchor } from '../lib/annotations';
import { defaultBrushWidth, imageColors, imageOpacity, imagePoint, strokePath } from '../lib/image-annotations';
import type { Color, ImagePoint, ImageStroke, Note } from '../lib/types';

type ImageAnnotationContextValue = {
  notes: Note[];
  drawing: { noteId: string; color: Color } | null;
  onStroke: (noteId: string, scope: string, imageKey: string, stroke: ImageStroke) => void;
  onSelect: (noteId: string) => void;
};
export const ImageAnnotationContext = createContext<ImageAnnotationContextValue | null>(null);

export function AnnotatedImage({ imageKey, scope, ...props }: ImgHTMLAttributes<HTMLImageElement> & { imageKey: string; scope: string }) {
  const context = useContext(ImageAnnotationContext);
  const ref = useRef<HTMLSpanElement>(null);
  const drawingRef = useRef<{ pointerId: number; noteId: string; points: ImagePoint[] } | null>(null);
  const [draft, setDraft] = useState<ImagePoint[]>([]);
  const [size, setSize] = useState({ width: 1000, height: 1000 });
  const drawing = context?.drawing;
  useEffect(() => { drawingRef.current = null; setDraft([]); }, [drawing?.noteId, drawing?.color]);
  const annotations = (context?.notes || []).flatMap(note => {
    const mark = readAnchor(note.rangeLoc)?.imageMarks?.find(item => item.scope === scope && item.imageKey === imageKey);
    return mark ? [{ noteId: note.id, color: note.color, strokes: mark.strokes }] : [];
  });
  function start(event: PointerEvent<SVGSVGElement>) {
    if (!drawing || event.button !== 0) return;
    event.preventDefault(); event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    const points = [imagePoint(event.clientX, event.clientY, event.currentTarget.getBoundingClientRect())];
    drawingRef.current = { pointerId: event.pointerId, noteId: drawing.noteId, points };
    setDraft(points);
  }
  function move(event: PointerEvent<SVGSVGElement>) {
    const current = drawingRef.current;
    if (!current || current.pointerId !== event.pointerId) return;
    event.preventDefault(); event.stopPropagation();
    const rect = event.currentTarget.getBoundingClientRect();
    const samples = event.nativeEvent.getCoalescedEvents?.() || [event.nativeEvent];
    const points = [...current.points];
    for (const sample of samples.length ? samples : [event.nativeEvent]) {
      const point = imagePoint(sample.clientX, sample.clientY, rect);
      const last = points[points.length - 1];
      if (points.length < 10000 && Math.hypot(point.x - last.x, point.y - last.y) >= 0.001) points.push(point);
    }
    current.points = points; setDraft(points);
  }
  function finish(event: PointerEvent<SVGSVGElement>, cancelled = false) {
    const current = drawingRef.current;
    if (!current || current.pointerId !== event.pointerId) return;
    event.preventDefault(); event.stopPropagation();
    drawingRef.current = null; setDraft([]);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (!cancelled) context?.onStroke(current.noteId, scope, imageKey, { points: current.points, width: defaultBrushWidth });
  }
  function stopMouseRelease(event: MouseEvent<SVGSVGElement> | TouchEvent<SVGSVGElement>) { event.stopPropagation(); }
  const { onLoad, ...imageProps } = props;
  return <span ref={ref} className={`annotated-image ${drawing ? 'image-drawing' : ''}`} data-image-key={imageKey} data-image-scope={scope}>
    <img {...imageProps} draggable={false} onLoad={event => { const image = event.currentTarget; setSize({ width: image.naturalWidth || 1, height: image.naturalHeight || 1 }); onLoad?.(event); }} />
    {context && <svg className="image-ink" viewBox={`0 0 ${size.width} ${size.height}`} preserveAspectRatio="none" aria-label={drawing ? '图片涂抹区域' : '图片笔记标记'} onPointerDown={start} onPointerMove={move} onPointerUp={event => finish(event)} onPointerCancel={event => finish(event, true)} onLostPointerCapture={event => finish(event, true)} onMouseUp={stopMouseRelease} onTouchEnd={stopMouseRelease}>
      {drawing && <rect width={size.width} height={size.height} fill="transparent" pointerEvents="all" />}
      {/* Opacity on the entire layer keeps repeated strokes translucent. */}
      <g opacity={imageOpacity} fill="none" strokeLinecap="round" strokeLinejoin="round">
        {annotations.map(mark => <g key={mark.noteId} stroke={imageColors[mark.color]} data-note-id={mark.noteId} className="image-note-strokes" onClick={event => { if (!drawing) { event.stopPropagation(); context.onSelect(mark.noteId); } }}>{mark.strokes.map((stroke, index) => <path key={index} d={strokePath(stroke.points, size.width, size.height, stroke.width)} strokeWidth={stroke.width * Math.min(size.width, size.height)} />)}</g>)}
        {drawing && draft.length > 0 && <path d={strokePath(draft, size.width, size.height)} stroke={imageColors[drawing.color]} strokeWidth={defaultBrushWidth * Math.min(size.width, size.height)} />}
      </g>
    </svg>}
  </span>;
}
