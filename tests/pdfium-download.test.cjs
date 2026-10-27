const test = require('node:test');
const assert = require('node:assert/strict');
const { gzipSync } = require('node:zlib');
const { fileURLToPath, pathToFileURL } = require('node:url');
const path = require('node:path');

function octal(value, width) {
  return `${value.toString(8).padStart(width - 1, '0')}\0`;
}

function tarGzip(entries) {
  const blocks = [];
  for (const [name, value] of entries) {
    const body = Buffer.from(value);
    const header = Buffer.alloc(512);
    header.write(name, 0, 100, 'utf8');
    header.write(octal(0o755, 8), 100, 8, 'ascii');
    header.write(octal(0, 8), 108, 8, 'ascii');
    header.write(octal(0, 8), 116, 8, 'ascii');
    header.write(octal(body.length, 12), 124, 12, 'ascii');
    header.write(octal(0, 12), 136, 12, 'ascii');
    header.fill(0x20, 148, 156);
    header[156] = '0'.charCodeAt(0);
    header.write('ustar\0', 257, 6, 'ascii');
    header.write('00', 263, 2, 'ascii');
    header.write(octal(header.reduce((sum, byte) => sum + byte, 0), 8), 148, 8, 'ascii');
    blocks.push(header, body);
    const padding = (512 - body.length % 512) % 512;
    if (padding) blocks.push(Buffer.alloc(padding));
  }
  blocks.push(Buffer.alloc(1024));
  return gzipSync(Buffer.concat(blocks));
}

test('PDFium downloader maps supported operating systems and CPU architectures', async () => {
  const { pdfiumAssetName } = await import(pathToFileURL(path.resolve('scripts/download-pdfium.mjs')).href);
  assert.equal(pdfiumAssetName('darwin', 'arm64'), 'pdfium-mac-arm64.tgz');
  assert.equal(pdfiumAssetName('darwin', 'x64'), 'pdfium-mac-x64.tgz');
  assert.equal(pdfiumAssetName('win32', 'x64'), 'pdfium-win-x64.tgz');
  assert.equal(pdfiumAssetName('linux', 'arm64'), 'pdfium-linux-arm64.tgz');
  assert.throws(() => pdfiumAssetName('linux', 'ia32'), /暂不支持/);
});

test('PDFium archive reader extracts only the expected shared library and license', async () => {
  const { readPdfiumTarGzip } = await import(pathToFileURL(path.resolve('scripts/download-pdfium.mjs')).href);
  const bytes = Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0x01, 0x02]);
  const archive = tarGzip([
    ['pkg/lib/libpdfium.so', bytes],
    ['pkg/LICENSE', 'PDFium license text'],
    ['pkg/extra.txt', 'not included'],
    ['../libpdfium.so', 'unsafe path'],
  ]);
  const result = readPdfiumTarGzip(archive, 'linux');
  assert.deepEqual(result.library, bytes);
  assert.equal(result.notices.length, 1);
  assert.equal(result.notices[0][0], 'pkg/LICENSE');
});
