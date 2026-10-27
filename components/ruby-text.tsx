import { rubyTextParts } from '../lib/ruby-text';
import { createElement } from 'react';

export function RubyText({ text }: { text: string }) {
  return <>{rubyTextParts(text).map((part, index) => part.type === 'ruby'
    ? createElement('ruby', { key: index }, createElement('rb', null, part.base), createElement('rt', null, part.reading))
    : <span key={index}>{part.text}</span>)}</>;
}
