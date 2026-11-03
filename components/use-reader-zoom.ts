'use client';

import { useEffect, useRef, useState } from 'react';

function createZoomStore() {
  let scale = 100;
  const listeners = new Set<() => void>();
  return {
    isZooming: false,
    changeScale: (_value: number) => {},
    zoomBy: (_delta: number) => {},
    getSnapshot: () => scale,
    getServerSnapshot: () => 100,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    publish(value: number) {
      if (scale === value) return;
      scale = value;
      listeners.forEach(listener => listener());
    },
  };
}
export type ReaderZoom = ReturnType<typeof createZoomStore>;

export function useReaderZoom() {
  const viewportRef = useRef<HTMLElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);
  // Only the small zoom controls subscribe. The book never renders for a zoom frame.
  const [zoom] = useState(createZoomStore);

  useEffect(() => {
    const viewport = viewportRef.current;
    const content = contentRef.current;
    const surface = surfaceRef.current;
    if (!viewport || !content || !surface) return;
    let current = 1;
    let target = 1;
    let width = viewport.clientWidth;
    let height = viewport.clientHeight;
    let contentHeight = 0;
    let frame = 0;
    let previousTime = 0;
    let lastInput = 0;
    let pointer: { x: number; y: number } | undefined;
    let anchor: { x: number; y: number; pointerX: number; pointerY: number } | undefined;
    let viewportRect = viewport.getBoundingClientRect();

    const sizeSurface = () => {
      surface.style.width = `${width * current}px`;
      surface.style.height = `${contentHeight * current}px`;
    };
    const finish = () => {
      zoom.isZooming = false;
      anchor = undefined;
      delete viewport.dataset.zooming;
      // Recompute progress and PDF visibility once, after the gesture settles.
      viewport.dispatchEvent(new Event('reader-zoom-end'));
      viewport.dispatchEvent(new Event('scroll'));
    };
    const animate = (now: number) => {
      frame = 0;
      const elapsed = previousTime ? Math.min(64, now - previousTime) : 16;
      previousTime = now;
      // Time-based easing also behaves consistently on 120 Hz displays.
      const next = Math.abs(target - current) < .0001 ? target
        : current + (target - current) * (1 - Math.exp(-elapsed / 40));
      if (next !== current) {
        // All reads precede writes. Only the lightweight surface changes layout;
        // the entire book retains its original text and image geometry.
        const x = Math.max(0, Math.min(width, pointer ? pointer.x - viewportRect.left : width / 2));
        const y = Math.max(0, Math.min(height, pointer ? pointer.y - viewportRect.top : height / 3));
        if (!anchor || anchor.pointerX !== x || anchor.pointerY !== y) {
          const oldMargin = Math.max(0, (width - width * current) / 2);
          anchor = { x: (viewport.scrollLeft + x - oldMargin) / current, y: (viewport.scrollTop + y) / current, pointerX: x, pointerY: y };
        }
        current = next;
        const newMargin = Math.max(0, (width - width * current) / 2);
        sizeSurface();
        content.style.transform = `scale(${current})`;
        viewport.scrollLeft = Math.max(0, anchor.x * current + newMargin - x);
        viewport.scrollTop = Math.max(0, anchor.y * current - y);
        zoom.publish(current * 100);
      }
      if (current !== target || now - lastInput < 120) frame = requestAnimationFrame(animate);
      else finish();
    };
    const requestScale = (value: number, point?: { x: number; y: number }) => {
      const next = Math.max(.5, Math.min(3, value));
      if (!Number.isFinite(next) || next === target) return;
      target = next;
      pointer = point;
      lastInput = performance.now();
      if (!zoom.isZooming) {
        viewportRect = viewport.getBoundingClientRect();
        zoom.isZooming = true;
        viewport.dataset.zooming = 'true';
        previousTime = 0;
      }
      if (!frame) frame = requestAnimationFrame(animate);
    };
    zoom.changeScale = value => requestScale(value / 100);
    zoom.zoomBy = delta => requestScale(target + delta / 100);

    content.style.width = `${width}px`;
    contentHeight = content.offsetHeight;
    sizeSurface();
    const resize = new ResizeObserver(entries => {
      for (const entry of entries) {
        if (entry.target === viewport) {
          anchor = undefined;
          width = viewport.clientWidth;
          height = viewport.clientHeight;
          viewportRect = viewport.getBoundingClientRect();
          content.style.width = `${width}px`;
        } else contentHeight = entry.contentRect.height;
      }
      sizeSurface();
    });
    resize.observe(viewport);
    resize.observe(content);
    const onWheel = (event: WheelEvent) => {
      // Chromium delivers macOS pinch as Ctrl+wheel, with delta = -100*log(scale).
      if (!event.ctrlKey) { anchor = undefined; return; }
      event.preventDefault();
      const units = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? height : 1;
      const delta = Math.max(-24, Math.min(24, event.deltaY * units));
      requestScale(target * Math.exp(-delta / 100), { x: event.clientX, y: event.clientY });
    };
    viewport.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      cancelAnimationFrame(frame);
      resize.disconnect();
      viewport.removeEventListener('wheel', onWheel);
      zoom.isZooming = false;
      zoom.changeScale = () => {};
      zoom.zoomBy = () => {};
    };
  }, [zoom]);

  return { viewportRef, contentRef, surfaceRef, zoom };
}
