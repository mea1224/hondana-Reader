const path = require('node:path');
const OPERATIONS = new Set(['library','book:open','chapter','book:update','book:remove','category:create','category:update','category:delete','notes:list','note:save','note:delete','progress:save']);
function validateOperation(operation, payload) {
  if (!OPERATIONS.has(operation)) throw new Error('不允许的操作');
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('无效操作参数');
  if (JSON.stringify(payload).length > 2 * 1024 * 1024) throw new Error('请求超过大小限制');
}
function safeAssetPath(root, pathname) {
  const relative = decodeURIComponent(pathname).replace(/^\/+/, '');
  if (relative.includes('\0') || relative.includes('\\') || relative.split('/').includes('..')) throw new Error('无效资源路径');
  const resolved = path.resolve(root, relative || 'index.html');
  if (resolved !== root && !resolved.startsWith(root + path.sep)) throw new Error('资源路径超出范围');
  return resolved;
}
function externalUrl(value) {
  const url = new URL(value);
  if (!['https:','http:'].includes(url.protocol)) throw new Error('只允许打开 HTTP / HTTPS 链接');
  return url.href;
}
module.exports = { validateOperation, safeAssetPath, externalUrl };
