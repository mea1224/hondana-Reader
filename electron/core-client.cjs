const path = require('node:path');
const { Worker } = require('node:worker_threads');
class CoreClient {
  constructor({ userData, nativePath }) {
    this.pending = new Map(); this.nextId = 1; this.failure = null;
    this.worker = new Worker(path.join(__dirname, 'core-worker.cjs'), { workerData: { dbPath: path.join(userData, 'hondana.sqlite3'), nativePath } });
    this.worker.on('message', (message) => { if (message.type === 'load-error') return; const pending = this.pending.get(message.id); if (!pending) return; this.pending.delete(message.id); message.ok ? pending.resolve(message.value) : pending.reject(new Error(message.error)); });
    const fail = error => { this.failure = error; for (const { reject } of this.pending.values()) reject(error); this.pending.clear(); };
    this.worker.on('error', fail);
    this.worker.on('exit', () => fail(new Error('阅读核心已关闭，请重新启动应用')));
  }
  dispatch(operation, payload = {}) {
    if (this.failure) return Promise.reject(this.failure);
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      try { this.worker.postMessage({ id, operation, payload }); }
      catch (error) { this.pending.delete(id); reject(error); }
    });
  }
  close() { this.failure = new Error('阅读核心已关闭'); return this.worker.terminate(); }
}
module.exports = { CoreClient };
