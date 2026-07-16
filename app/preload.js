const { contextBridge, ipcRenderer, webUtils } = require('electron');
const { marked } = require('marked');

marked.setOptions({ gfm: true, breaks: true });

contextBridge.exposeInMainWorld('api', {
  getVault: () => ipcRenderer.invoke('vault:get'),
  chooseVault: () => ipcRenderer.invoke('vault:choose'),
  revealVault: () => ipcRenderer.invoke('vault:reveal'),
  getTree: () => ipcRenderer.invoke('vault:tree'),
  getAllNotes: () => ipcRenderer.invoke('notes:all'),
  readNote: (rel) => ipcRenderer.invoke('note:read', rel),
  writeNote: (rel, content) => ipcRenderer.invoke('note:write', rel, content),
  createNote: (folderRel, baseName) => ipcRenderer.invoke('note:create', folderRel, baseName),
  renameNote: (rel, newName) => ipcRenderer.invoke('note:rename', rel, newName),
  deleteNote: (rel) => ipcRenderer.invoke('note:delete', rel),
  createFolder: (parentRel, name) => ipcRenderer.invoke('folder:create', parentRel, name),
  renameFolder: (rel, newName) => ipcRenderer.invoke('folder:rename', rel, newName),
  moveNote: (rel, targetFolderRel) => ipcRenderer.invoke('note:move', rel, targetFolderRel),
  importNote: (absPath) => ipcRenderer.invoke('note:import', absPath),
  getPathForFile: (file) => webUtils.getPathForFile(file),
  onVaultChanged: (cb) => ipcRenderer.on('vault:changed', () => cb()),
  exportNote: (name, html, format) => ipcRenderer.invoke('note:export', name, html, format),
  openExternal: (url) => ipcRenderer.invoke('open:external', url),
  onUpdateAvailable: (cb) => ipcRenderer.on('update:available', (_e, info) => cb(info)),
  onUpdateError: (cb) => ipcRenderer.on('update:error', () => cb()),
  installUpdate: () => ipcRenderer.send('update:install'),
});

contextBridge.exposeInMainWorld('markdown', {
  render: (src) => marked.parse(src),
});
