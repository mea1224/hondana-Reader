'use client';

import { memo, useSyncExternalStore } from 'react';
import { RotateCcw } from 'lucide-react';
import type { ReaderZoom } from './use-reader-zoom';

export const ReaderZoomControls = memo(function ReaderZoomControls({ zoom }: { zoom: ReaderZoom }) {
  const scale = useSyncExternalStore(zoom.subscribe, zoom.getSnapshot, zoom.getServerSnapshot);
  return <>
    <button className="reader-control" disabled={scale <= 50} onClick={() => zoom.zoomBy(-10)} aria-label="缩小">A−</button>
    <span className="reader-scale" aria-label={`当前缩放比例 ${Math.round(scale)}%`}>{Math.round(scale)}%</span>
    <button className="icon-button reader-reset-scale" title="重置缩放为 100%" aria-label="重置缩放" onClick={() => zoom.changeScale(100)}><RotateCcw size={15} /></button>
    <button className="reader-control" disabled={scale >= 300} onClick={() => zoom.zoomBy(10)} aria-label="放大">A+</button>
  </>;
});
