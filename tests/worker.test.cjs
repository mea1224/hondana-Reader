const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { CoreClient } = require('../electron/core-client.cjs');

test('worker reports missing native library and rejects calls after close', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hondana-worker-'));
  const core = new CoreClient({ userData: dir, nativePath: path.join(dir, 'missing.node') });
  t.after(async () => { await core.close(); fs.rmSync(dir, { recursive: true, force: true }); });
  await assert.rejects(core.dispatch('library'), /native:build/);
  await core.close();
  await assert.rejects(core.dispatch('library'), /关闭/);
});
