import type { Metadata } from 'next';
import './globals.css';
import { WindowFrame } from '../components/window-frame';

export const metadata: Metadata = {
  title: 'hondana Reader',
  description: 'A calm, local-first reading desk for EPUB, PDF and Markdown books.',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN"><body><WindowFrame>{children}</WindowFrame></body></html>;
}
