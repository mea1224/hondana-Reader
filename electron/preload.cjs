const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('hondana', {
  dispatch: (operation, payload) => ipcRenderer.invoke('core:dispatch', operation, payload),
  importBooks: () => ipcRenderer.invoke('dialog:import'),
  readResource: (bookId, resourcePath) => ipcRenderer.invoke('core:read-resource', bookId, resourcePath),
  renderPdf: (bookId, page, width) => ipcRenderer.invoke('core:render-pdf', bookId, page, width),
  openExternal: (url) => ipcRenderer.invoke('shell:open-external', url),
  exportMarkdown: (fileName, content) => ipcRenderer.invoke('notes:export-markdown', fileName, content),
});
