'use client';
import { useState } from 'react';
import ReactMarkdown, { defaultUrlTransform } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { epubAnchors, headingIds, rubyAnnotations } from '../lib/markdown';
import { openExternal, resourceUrl } from '../lib/api';
import type { ChapterAnchor } from '../lib/types';
import { AnnotatedImage } from './annotated-image';

function EpubImage({ src, alt, imageKey, scope }: { src: string; alt: string; imageKey: string; scope: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) return <span role="alert" className="epub-image-error">图片加载失败：{alt} <button type="button" onClick={() => setFailed(false)}>重试</button></span>;
  return <AnnotatedImage imageKey={imageKey} scope={scope} className="epub-image" src={src} alt={alt} decoding="async" onError={() => setFailed(true)} />;
}

export function Markdown({ text, anchors = [], resourceBookId, imageScope = 'document' }: { text: string; anchors?: ChapterAnchor[]; resourceBookId?: string; imageScope?: string }) {
  return <ReactMarkdown
    urlTransform={(url, key, node) => key === 'src' && node.tagName === 'img' && resourceBookId && url.startsWith('epub-resource:') ? url : defaultUrlTransform(url)}
    remarkPlugins={[remarkGfm]}
    rehypePlugins={[rubyAnnotations, headingIds, [epubAnchors, { anchors }]]}
    components={{
      a: ({ href, children }) => <a href={href} onClick={event => {
        event.preventDefault();
        if (href && /^https?:/i.test(href)) openExternal(href);
        else if (href?.startsWith('#')) { try { document.getElementById(decodeURIComponent(href.slice(1)))?.scrollIntoView({ behavior: 'smooth' }); } catch {} }
      }}>{children}</a>,
      img: ({ src, alt, node }) => {
        if (typeof src === 'string' && src.startsWith('epub-resource:') && resourceBookId) {
          try {
            // The core encodes the ZIP path once; Markdown preserves its escapes.
            // resourceUrl then encodes it for the resource protocol's single decode.
            const path = decodeURIComponent(src.slice('epub-resource:'.length));
            const url = resourceUrl(resourceBookId, path);
            return <EpubImage key={url} src={url} alt={alt || '图片'} imageKey={`${node?.position?.start.offset ?? 0}:${path}`} scope={imageScope} />;
          } catch {
            return <span role="alert" className="image-placeholder">图片路径无效</span>;
          }
        }
        return <span className="image-placeholder">[图片：{alt || '本地图片'}]</span>;
      },
    }}
  >{text}</ReactMarkdown>;
}
