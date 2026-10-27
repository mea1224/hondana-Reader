const { app, BrowserWindow, dialog, ipcMain, shell, protocol, net, session } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');
const { CoreClient } = require('./core-client.cjs');
const { validateOperation, safeAssetPath, externalUrl } = require('./security.cjs');

protocol.registerSchemesAsPrivileged([{ scheme: 'hondana', privileges: { standard: true, secure: true, supportFetchAPI: true } }, { scheme: 'hondana-resource', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);
app.commandLine.appendSwitch('disable-features', 'Translate,AuxiliaryDisplay,MediaRouter');
let core;
let mainWindow;
const dev = !app.isPackaged && process.env.HONDANA_DEV === '1';
const pdfiumDir = () => process.env.HONDANA_PDFIUM_DIR || path.join(app.isPackaged ? process.resourcesPath : path.join(__dirname, '..', 'resources'), 'pdfium');
function nativePath() {
  const suffix = process.platform === 'win32' ? 'msvc' : process.platform === 'linux' ? 'gnu' : '';
  const name = `hondana_core.${process.platform}-${process.arch}${suffix ? '-' + suffix : ''}.node`;
  return path.join(app.isPackaged ? path.join(process.resourcesPath, 'native') : path.join(__dirname, '..', 'native'), name);
}
function checkSender(event) {
  const origin = event.senderFrame?.url;
  if (!origin || event.senderFrame !== mainWindow?.webContents.mainFrame || (dev ? new URL(origin).origin !== 'http://127.0.0.1:3210' : !origin.startsWith('hondana://app/'))) throw new Error('不受信任的 IPC 来源');
}
function handle(channel, handler) { ipcMain.handle(channel, (event, ...args) => { checkSender(event); return handler(...args); }); }
function createWindow() {
  mainWindow = new BrowserWindow({ width: 1440, height: 920, minWidth: 800, minHeight: 600, title: 'hondana Reader', icon: path.join(__dirname, 'icon.png'), backgroundColor: '#fbfaf8', webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, webSecurity: true } });
  mainWindow.loadURL(dev ? 'http://127.0.0.1:3210' : 'hondana://app/');
  mainWindow.webContents.setWindowOpenHandler(({ url }) => { try { void shell.openExternal(externalUrl(url)); } catch {} return { action: 'deny' }; });
  mainWindow.webContents.on('will-navigate', (event, url) => { if (url !== mainWindow.webContents.getURL()) { event.preventDefault(); try { void shell.openExternal(externalUrl(url)); } catch {} } });
}
app.whenReady().then(() => {
  fs.mkdirSync(app.getPath('userData'), { recursive: true });
  core = new CoreClient({ userData: app.getPath('userData'), nativePath: nativePath() });
  const outputRoot = path.join(__dirname, '..', 'out');
  protocol.handle('hondana', async request => {
    try { const url = new URL(request.url); if (url.hostname !== 'app') return new Response('Not found', { status: 404 }); return await net.fetch(pathToFileURL(safeAssetPath(outputRoot, url.pathname)).href); }
    catch { return new Response('Not found', { status: 404 }); }
  });
  protocol.handle('hondana-resource', async request => {
    try {
      const url = new URL(request.url); if (url.hostname !== 'book') return new Response('Not found', { status: 404 });
      const [,id,...segments] = url.pathname.split('/'); const resourcePath = segments.map(decodeURIComponent).join('/');
      const extension = path.extname(resourcePath).toLowerCase();
      const mime = { '.jpg':'image/jpeg','.jpeg':'image/jpeg','.png':'image/png','.webp':'image/webp','.gif':'image/gif','.avif':'image/avif','.svg':'image/svg+xml','.bmp':'image/bmp' }[extension];
      if (!mime) return new Response('Unsupported resource', { status: 415 });
      const bytes = await core.dispatch('resource', { bookId:id, resourcePath });
      return new Response(bytes, { headers: { 'Content-Type':mime, 'Cache-Control':'private, max-age=3600', 'X-Content-Type-Options':'nosniff' } });
    } catch { return new Response('Not found', { status: 404 }); }
  });
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    const csp = "default-src 'self'; script-src 'self' 'unsafe-inline'" + (dev ? " 'unsafe-eval'" : '') + "; style-src 'self' 'unsafe-inline'; img-src 'self' hondana-resource: blob: data:; connect-src 'self'" + (dev ? ' ws://127.0.0.1:3210' : '') + "; font-src 'self'; object-src 'none'; frame-src 'none'; base-uri 'self'";
    callback({ responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy':[csp] } });
  });
  handle('core:dispatch', (operation, payload = {}) => { validateOperation(operation, payload); return core.dispatch(operation, operation === 'book:open' ? { ...payload, pdfiumDir:pdfiumDir() } : payload); });
  handle('core:read-resource', (bookId, resourcePath) => core.dispatch('resource', { bookId, resourcePath }));
  handle('core:render-pdf', (bookId, page, width) => { if (typeof bookId !== 'string' || !Number.isInteger(page) || page < 0 || !Number.isInteger(width) || width < 200 || width > 1800) throw new Error('无效 PDF 请求'); return core.dispatch('render-pdf', { bookId, page, width, pdfiumDir:pdfiumDir() }); });
  handle('dialog:import', async () => { const result = await dialog.showOpenDialog(mainWindow, { properties:['openFile','multiSelections'], filters:[{ name:'图书', extensions:['epub','pdf','md','markdown'] }] }); return result.canceled ? { ids:[], errors:[] } : core.dispatch('import', { paths:result.filePaths }); });
  handle('shell:open-external', url => shell.openExternal(externalUrl(url)));
  handle('notes:export-markdown', async (fileName, content) => {
    if (typeof fileName !== 'string' || typeof content !== 'string' || Buffer.byteLength(content, 'utf8') > 16 * 1024 * 1024) throw new Error('无效的笔记导出内容');
    const safeName = path.basename(fileName.replace(/[\u0000-\u001f<>:"/\\|?*]/g, '-')).replace(/\.md$/i, '') || 'hondana-笔记';
    const result = await dialog.showSaveDialog(mainWindow, { title: '导出笔记', defaultPath: `${safeName}.md`, buttonLabel: '导出', filters: [{ name: 'Markdown', extensions: ['md'] }] });
    if (result.canceled || !result.filePath) return false;
    await fs.promises.writeFile(result.filePath, content, 'utf8');
    return true;
  });
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
}).catch(error => { dialog.showErrorBox('hondana Reader 启动失败', error.message); app.quit(); });
app.on('will-quit', () => { void core?.close(); });
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
