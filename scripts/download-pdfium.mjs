import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, posix, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { gunzipSync } from 'node:zlib';

const root = fileURLToPath(new URL('..', import.meta.url));
// Keep this aligned with pdfium-render's `pdfium_latest` feature in Cargo.toml.
const PDFIUM_RELEASE_TAG = 'chromium/7543';
const releaseApi = 'https://api.github.com/repos/bblanchon/pdfium-binaries/releases';
const libraryNames = { darwin: 'libpdfium.dylib', win32: 'pdfium.dll', linux: 'libpdfium.so' };

export function pdfiumAssetName(platform, arch) {
  const os = { darwin: 'mac', win32: 'win', linux: 'linux' }[platform];
  if (!os || !['arm64', 'x64'].includes(arch)) {
    throw new Error(`当前平台暂不支持自动下载 PDFium：${platform}/${arch}（支持 macOS、Windows、Linux 的 x64 和 ARM64）`);
  }
  return `pdfium-${os}-${arch}.tgz`;
}

function safeArchivePath(value) {
  const name = value.replaceAll('\\', '/');
  if (!name || name.startsWith('/') || /^[a-zA-Z]:/.test(name)) return null;
  const parts = name.split('/').filter(part => part && part !== '.');
  if (parts.includes('..')) return null;
  return parts.join('/');
}

export function readPdfiumTarGzip(archive, platform) {
  const expectedName = libraryNames[platform];
  if (!expectedName) throw new Error(`不支持的 PDFium 平台：${platform}`);
  const tar = gunzipSync(archive, { maxOutputLength: 256 * 1024 * 1024 });
  const files = new Map();
  let offset = 0;
  while (offset + 512 <= tar.length) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every(byte => byte === 0)) break;
    const name = header.subarray(0, 100).toString('utf8').replace(/\0.*$/, '');
    const prefix = header.subarray(345, 500).toString('utf8').replace(/\0.*$/, '');
    const entry = safeArchivePath(prefix ? `${prefix}/${name}` : name);
    const sizeText = header.subarray(124, 136).toString('ascii').replace(/\0.*$/, '').trim();
    const size = Number.parseInt(sizeText || '0', 8);
    if (!Number.isSafeInteger(size) || size < 0) throw new Error('PDFium 压缩包包含无效条目长度');
    const dataStart = offset + 512;
    const dataEnd = dataStart + size;
    if (dataEnd > tar.length) throw new Error('PDFium 压缩包被截断');
    const type = String.fromCharCode(header[156] || 48);
    if (entry && (type === '0' || type === '\0')) {
      const base = posix.basename(entry);
      if (base === expectedName || /^LICENSE(?:\.|$)/i.test(base) || /^NOTICE(?:\.|$)/i.test(base)) {
        files.set(entry, Buffer.from(tar.subarray(dataStart, dataEnd)));
      }
    }
    offset = dataStart + Math.ceil(size / 512) * 512;
  }
  const library = [...files].find(([name]) => posix.basename(name) === expectedName)?.[1];
  if (!library?.length) throw new Error(`PDFium 压缩包内没有 ${expectedName}`);
  return { library, notices: [...files].filter(([name]) => posix.basename(name) !== expectedName) };
}

async function readJson(url) {
  const response = await fetch(url, {
    headers: { accept: 'application/vnd.github+json', 'user-agent': 'hondana-reader-pdfium-fetcher' },
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) throw new Error(`读取 PDFium 发布信息失败：HTTP ${response.status}`);
  return response.json();
}

async function downloadAsset(asset, archivePath) {
  const response = await fetch(asset.browser_download_url, {
    headers: { 'user-agent': 'hondana-reader-pdfium-fetcher' },
    signal: AbortSignal.timeout(180_000),
  });
  if (!response.ok || !response.body) throw new Error(`下载 ${asset.name} 失败：HTTP ${response.status}`);
  const hash = createHash('sha256');
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.byteLength;
    if (size > 100 * 1024 * 1024) throw new Error('PDFium 发布包超过 100 MB，已中止下载');
    const bytes = Buffer.from(chunk);
    hash.update(bytes);
    chunks.push(bytes);
  }
  if (!size) throw new Error('PDFium 下载结果为空');
  const digest = asset.digest?.match(/^sha256:([a-f\d]{64})$/i)?.[1];
  if (!digest) throw new Error(`GitHub 没有为 ${asset.name} 提供 SHA-256 摘要，已中止安装`);
  const actual = hash.digest('hex');
  if (actual.toLowerCase() !== digest.toLowerCase()) throw new Error(`PDFium SHA-256 校验失败：${actual}`);
  writeFileSync(archivePath, Buffer.concat(chunks, size));
}

export async function installPdfium({ platform = process.platform, arch = process.arch, destination = join(root, 'resources', 'pdfium'), tag = process.env.HONDANA_PDFIUM_TAG || PDFIUM_RELEASE_TAG } = {}) {
  const assetName = pdfiumAssetName(platform, arch);
  const libraryName = libraryNames[platform];
  const versionFile = join(destination, '.pdfium-version');
  const installedLibrary = join(destination, libraryName);
  try {
    const installed = JSON.parse(readFileSync(versionFile, 'utf8'));
    const installedBytes = readFileSync(installedLibrary);
    const installedDigest = createHash('sha256').update(installedBytes).digest('hex');
    if (installed.tag === tag && installed.asset === assetName && installed.libraryDigest === installedDigest) {
      console.log(`PDFium ${tag} 已安装：${installedLibrary}`);
      return installedLibrary;
    }
  } catch {}

  const release = await readJson(`${releaseApi}/tags/${encodeURIComponent(tag)}`);
  const asset = release.assets?.find(candidate => candidate.name === assetName);
  if (!asset) throw new Error(`PDFium ${release.tag_name || '当前版本'} 没有 ${assetName} 发布包`);
  try {
    const installed = JSON.parse(readFileSync(versionFile, 'utf8'));
    const installedBytes = readFileSync(installedLibrary);
    const installedDigest = createHash('sha256').update(installedBytes).digest('hex');
    if (installed.tag === release.tag_name && installed.asset === asset.name && installed.assetDigest === asset.digest && installed.libraryDigest === installedDigest) {
      console.log(`PDFium ${release.tag_name} 已安装：${installedLibrary}`);
      return installedLibrary;
    }
  } catch {}

  const tempRoot = join(tmpdir(), `hondana-pdfium-${process.pid}-${Date.now()}`);
  const archivePath = join(tempRoot, assetName);
  mkdirSync(tempRoot, { recursive: true });
  try {
    console.log(`正在从 PDFium 官方发布源下载 ${assetName}（${release.tag_name}）…`);
    const mirror = process.env.HONDANA_PDFIUM_MIRROR?.replace(/\/+$/, '');
    const download = mirror ? { ...asset, browser_download_url: `${mirror}/${asset.browser_download_url}` } : asset;
    await downloadAsset(download, archivePath);
    const { library, notices } = readPdfiumTarGzip(readFileSync(archivePath), platform);
    mkdirSync(destination, { recursive: true });
    const stagedLibrary = `${installedLibrary}.download`;
    writeFileSync(stagedLibrary, library, { mode: 0o755 });
    renameSync(stagedLibrary, installedLibrary);
    const noticeDir = join(destination, 'licenses');
    rmSync(noticeDir, { recursive: true, force: true });
    for (const [name, contents] of notices) {
      const safeName = safeArchivePath(name);
      if (!safeName) continue;
      const target = join(noticeDir, safeName);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, contents);
    }
    const libraryDigest = createHash('sha256').update(library).digest('hex');
    writeFileSync(versionFile, `${JSON.stringify({ tag: release.tag_name, asset: asset.name, assetDigest: asset.digest, libraryDigest }, null, 2)}\n`);
    console.log(`PDFium ${release.tag_name} 已安装并校验：${installedLibrary}`);
    return installedLibrary;
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  installPdfium().catch(error => {
    console.error(`自动安装 PDFium 失败：${error.message}`);
    process.exitCode = 1;
  });
}
