'use client';

import { useEffect, useState } from 'react';
import { Copy, Minus, Square, X } from 'lucide-react';
import type { WindowState } from '../lib/types';

export function WindowFrame({ children }: { children: React.ReactNode }) {
  const [desktop, setDesktop] = useState(false);
  const [state, setState] = useState<WindowState>({ maximized: false, fullscreen: false });
  const [error, setError] = useState('');
  useEffect(() => {
    const bridge = window.hondana;
    if (!bridge) return;
    setDesktop(true);
    const unsubscribe = bridge.onWindowState(setState);
    void bridge.windowState().then(setState).catch(() => setError('无法读取窗口状态'));
    return unsubscribe;
  }, []);
  function run(action: Promise<unknown> | undefined) {
    setError('');
    void action?.catch(() => setError('窗口操作失败，请重试'));
  }
  const expanded = state.maximized || state.fullscreen;
  return <div className={`window-frame ${desktop ? 'desktop-window' : ''} ${expanded ? 'window-expanded' : ''}`}>
    <div className="window-content">{children}</div>
    {desktop && <div className="window-controls" aria-label="窗口控制">
      <button title="最小化" aria-label="最小化" onClick={() => run(window.hondana?.minimize())}><Minus size={15} /></button>
      <button title={expanded ? '还原' : '最大化'} aria-label={expanded ? '还原' : '最大化'} onClick={() => run(window.hondana?.toggleMaximize())}>{expanded ? <Copy size={13} /> : <Square size={13} />}</button>
      <button className="window-close" title="关闭" aria-label="关闭窗口" onClick={() => run(window.hondana?.close())}><X size={16} /></button>
    </div>}
    {error && <div className="window-error" role="alert">{error}</div>}
  </div>;
}
