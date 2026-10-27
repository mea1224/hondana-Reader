const { parentPort, workerData } = require('node:worker_threads');
let core;
try { core = require(workerData.nativePath); }
catch (error) { core = null; parentPort.postMessage({ type: 'load-error', message: error instanceof Error ? error.message : String(error) }); }
parentPort.on('message', ({ id, operation, payload }) => {
  try {
    if (!core) throw new Error('Rust 核心模块尚未构建，请先运行 npm run native:build');
    if (operation === 'resource') {
      const value = core.readResource(workerData.dbPath, payload.bookId, payload.resourcePath);
      parentPort.postMessage({ id, ok: true, value });
      return;
    }
    if (operation === 'render-pdf') {
      const value = core.renderPdf(workerData.dbPath, payload.bookId, payload.page, payload.width, payload.pdfiumDir);
      parentPort.postMessage({ id, ok: true, value });
      return;
    }
    const value = core.dispatch(workerData.dbPath, operation, JSON.stringify(payload ?? {}));
    parentPort.postMessage({ id, ok: true, value: JSON.parse(value) });
  } catch (error) { parentPort.postMessage({ id, ok: false, error: error instanceof Error ? error.message : String(error) }); }
});
