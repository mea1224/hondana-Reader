'use client';

import { useState } from 'react';
import { desktop, resourceUrl } from '../lib/api';
import type { Book } from '../lib/types';

const coverColors = ['rust', 'indigo', 'amber', 'teal', 'slate', 'plum'];

export default function Cover({ book, large = false }: { book: Book; large?: boolean }) {
  const [failed, setFailed] = useState(false);
  const color = coverColors[book.id.charCodeAt(0) % coverColors.length];
  const source = desktop() && book.coverPath && !failed ? resourceUrl(book.id, book.coverPath) : null;
  return <div className={`book-cover cover-${color} ${large ? 'book-cover-large' : ''}`}>
    {source ? <img alt={`${book.title} 封面`} src={source} onError={() => setFailed(true)} className="cover-image" /> : <><span className="cover-type">{book.fileType.toUpperCase()}</span><div className="cover-title">{book.title}</div><div className="cover-author">{book.author || (book.fileType === 'md' ? 'MARKDOWN DOCUMENT' : 'HONDANA LIBRARY')}</div><span className="cover-mark">h</span></>}
  </div>;
}
