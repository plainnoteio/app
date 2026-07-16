const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const fs = require('fs');
const path = require('path');

const configFile = () => path.join(app.getPath('userData'), 'config.json');

const DEFAULT_ZOOM = 1.2;

let vaultPath = null;
let win = null;

function loadConfig() {
  try {
    const cfg = JSON.parse(fs.readFileSync(configFile(), 'utf8'));
    if (cfg.vaultPath && fs.existsSync(cfg.vaultPath)) {
      // Dev runs must never open the real vault, even if the config points there
      const realVault = path.join(app.getPath('documents'), 'Plainnote');
      if (!app.isPackaged && path.resolve(cfg.vaultPath) === realVault) return null;
      return cfg.vaultPath;
    }
  } catch (_) {}
  return null;
}

function saveConfig() {
  fs.writeFileSync(configFile(), JSON.stringify({ vaultPath }, null, 2));
}

const WELCOME = `# Welcome to Plainnote

A clean home for your thoughts. Your notes live as plain markdown files in this vault folder, so they are always yours.

## The basics

- Write in **markdown** — headings, lists, \`code\`, and more
- Toggle between **Edit**, **Split**, and **Read** with the buttons up top (or Cmd+E)
- Everything saves automatically as you type

## Link your notes

Wrap a note name in double brackets to link it, like [[Ideas]]. If the note doesn't exist yet, clicking the link creates it. Scroll down in any note to see its **backlinks** — every note that points to it.

## Stay organized

Use #tags anywhere in a note and they'll show up in the sidebar. Try #getting-started. Create folders with the folder button, and search everything with the box up top.

Happy writing ✏️
`;

function ensureVault() {
  if (!vaultPath) {
    vaultPath = path.join(app.getPath('documents'), app.isPackaged ? 'Plainnote' : 'Plainnote-dev');
  }
  if (!fs.existsSync(vaultPath)) {
    fs.mkdirSync(vaultPath, { recursive: true });
  }
  const entries = fs.readdirSync(vaultPath).filter((f) => !f.startsWith('.'));
  if (entries.length === 0) {
    fs.writeFileSync(path.join(vaultPath, 'Welcome.md'), WELCOME);
  }
  saveConfig();
}

function safeJoin(rel) {
  const full = path.resolve(vaultPath, rel || '');
  const root = path.resolve(vaultPath);
  if (full !== root && !full.startsWith(root + path.sep)) {
    throw new Error('Path escapes vault');
  }
  return full;
}

function listTree(dir, rel = '') {
  const items = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const childRel = rel ? path.join(rel, entry.name) : entry.name;
    if (entry.isDirectory()) {
      items.push({
        type: 'folder',
        name: entry.name,
        path: childRel,
        children: listTree(path.join(dir, entry.name), childRel),
      });
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
      items.push({
        type: 'note',
        name: entry.name.replace(/\.md$/i, ''),
        path: childRel,
      });
    }
  }
  items.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'folder' ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
  });
  return items;
}

function readAll(dir, rel = '') {
  let out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const childRel = rel ? path.join(rel, entry.name) : entry.name;
    if (entry.isDirectory()) {
      out = out.concat(readAll(path.join(dir, entry.name), childRel));
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
      out.push({
        path: childRel,
        name: entry.name.replace(/\.md$/i, ''),
        content: fs.readFileSync(path.join(dir, entry.name), 'utf8'),
      });
    }
  }
  return out;
}

function uniqueNotePath(folderRel, baseName) {
  let name = baseName;
  let i = 1;
  while (fs.existsSync(safeJoin(path.join(folderRel, name + '.md')))) {
    i += 1;
    name = `${baseName} ${i}`;
  }
  return path.join(folderRel, name + '.md');
}

let watcher = null;
let watchTimer = null;
function watchVault() {
  if (watcher) watcher.close();
  try {
    watcher = fs.watch(vaultPath, { recursive: true }, () => {
      clearTimeout(watchTimer);
      watchTimer = setTimeout(() => {
        if (win && !win.isDestroyed()) win.webContents.send('vault:changed');
      }, 400);
    });
  } catch (_) {
    watcher = null;
  }
}

function registerIpc() {
  ipcMain.handle('vault:get', () => vaultPath);

  ipcMain.handle('vault:choose', async () => {
    const res = await dialog.showOpenDialog(win, {
      title: 'Choose a vault folder',
      defaultPath: vaultPath,
      properties: ['openDirectory', 'createDirectory'],
    });
    if (res.canceled || res.filePaths.length === 0) return null;
    vaultPath = res.filePaths[0];
    ensureVault();
    watchVault();
    return vaultPath;
  });

  ipcMain.handle('vault:reveal', () => shell.openPath(vaultPath));

  ipcMain.handle('open:external', (_e, url) => {
    if (typeof url === 'string' && /^https?:\/\//i.test(url)) shell.openExternal(url);
  });

  ipcMain.on('app:reset-zoom', () => {
    if (win && !win.isDestroyed()) win.webContents.setZoomFactor(DEFAULT_ZOOM);
  });

  ipcMain.handle('vault:tree', () => listTree(vaultPath));
  ipcMain.handle('notes:all', () => readAll(vaultPath));

  ipcMain.handle('note:read', (_e, rel) => fs.readFileSync(safeJoin(rel), 'utf8'));

  ipcMain.handle('note:write', (_e, rel, content) => {
    fs.writeFileSync(safeJoin(rel), content);
    return true;
  });

  ipcMain.handle('note:create', (_e, folderRel, baseName) => {
    const rel = uniqueNotePath(folderRel || '', baseName || 'Untitled');
    fs.writeFileSync(safeJoin(rel), '');
    return rel;
  });

  ipcMain.handle('note:rename', (_e, rel, newName) => {
    const clean = newName.replace(/[\\/:]/g, '-').trim();
    if (!clean) throw new Error('Empty name');
    const dir = path.dirname(rel);
    const newRel = path.join(dir === '.' ? '' : dir, clean + '.md');
    if (newRel === rel) return rel;
    if (fs.existsSync(safeJoin(newRel))) throw new Error('A note with that name already exists');
    fs.renameSync(safeJoin(rel), safeJoin(newRel));
    return newRel;
  });

  ipcMain.handle('note:move', (_e, rel, targetFolderRel) => {
    const fromDir = path.dirname(rel) === '.' ? '' : path.dirname(rel);
    const toDir = targetFolderRel || '';
    if (fromDir === toDir) return rel;
    const name = path.basename(rel, '.md');
    const newRel = uniqueNotePath(toDir, name);
    fs.renameSync(safeJoin(rel), safeJoin(newRel));
    return newRel;
  });

  ipcMain.handle('note:import', (_e, absPath) => {
    if (!/\.(md|markdown|txt)$/i.test(absPath)) throw new Error('Only .md and .txt files can be imported');
    const base = path.basename(absPath).replace(/\.(md|markdown|txt)$/i, '');
    const rel = uniqueNotePath('', base);
    fs.copyFileSync(absPath, safeJoin(rel));
    return rel;
  });

  ipcMain.handle('note:delete', async (_e, rel) => {
    await shell.trashItem(safeJoin(rel));
    return true;
  });

  ipcMain.handle('folder:delete', async (_e, rel) => {
    if (!rel) throw new Error('Refusing to trash the vault root');
    await shell.trashItem(safeJoin(rel));
    return true;
  });

  ipcMain.handle('note:export', async (_e, name, html, format) => {
    const clean = (name || 'note').replace(/[\\/:]/g, '-');
    const res = await dialog.showSaveDialog(win, {
      title: 'Export note',
      defaultPath: path.join(app.getPath('desktop'), clean + (format === 'pdf' ? '.pdf' : '.html')),
      filters: format === 'pdf' ? [{ name: 'PDF', extensions: ['pdf'] }] : [{ name: 'HTML', extensions: ['html'] }],
    });
    if (res.canceled || !res.filePath) return null;
    if (format === 'html') {
      fs.writeFileSync(res.filePath, html);
      return res.filePath;
    }
    const w = new BrowserWindow({ show: false, webPreferences: { sandbox: true } });
    await w.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
    await new Promise((r) => setTimeout(r, 200));
    const pdf = await w.webContents.printToPDF({ pageSize: 'A4', printBackground: true });
    w.destroy();
    fs.writeFileSync(res.filePath, pdf);
    return res.filePath;
  });

  ipcMain.handle('folder:rename', (_e, rel, newName) => {
    const clean = (newName || '').replace(/[\\/:]/g, '-').trim();
    if (!clean) throw new Error('Empty name');
    const dir = path.dirname(rel);
    const newRel = path.join(dir === '.' ? '' : dir, clean);
    if (newRel === rel) return rel;
    if (fs.existsSync(safeJoin(newRel))) throw new Error('A folder with that name already exists');
    fs.renameSync(safeJoin(rel), safeJoin(newRel));
    return newRel;
  });

  ipcMain.handle('folder:create', (_e, parentRel, name) => {
    const clean = (name || '').replace(/[\\/:]/g, '-').trim();
    if (!clean) throw new Error('Empty name');
    const rel = path.join(parentRel || '', clean);
    fs.mkdirSync(safeJoin(rel), { recursive: true });
    return rel;
  });
}

function createWindow() {
  win = new BrowserWindow({
    width: 1240,
    height: 820,
    minWidth: 760,
    minHeight: 480,
    backgroundColor: '#ffffff',
    title: 'Plainnote',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      zoomFactor: DEFAULT_ZOOM,
    },
  });
  win.loadFile(path.join(__dirname, 'index.html'));

  // Notes can contain arbitrary links — never navigate the app window itself
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e) => e.preventDefault());
}

function setupAutoUpdates() {
  ipcMain.handle('app:version', () => app.getVersion());
  if (!app.isPackaged) {
    ipcMain.handle('update:check', () => 'latest');
    return;
  }
  const { autoUpdater } = require('electron-updater');
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.on('error', () => {
    // offline, rate-limited, etc. — let the toast recover, otherwise stay silent
    if (win && !win.isDestroyed()) win.webContents.send('update:error');
  });
  autoUpdater.on('update-available', (info) => {
    if (win && !win.isDestroyed()) {
      win.webContents.send('update:available', { version: info.version });
    }
  });
  autoUpdater.on('update-downloaded', () => autoUpdater.quitAndInstall());
  ipcMain.on('update:install', () => autoUpdater.downloadUpdate().catch(() => {}));
  ipcMain.handle('update:check', async () => {
    try {
      const res = await autoUpdater.checkForUpdates();
      const available = res && (res.isUpdateAvailable
        ?? (res.updateInfo && res.updateInfo.version !== app.getVersion()));
      return available ? 'update' : 'latest';
    } catch (_) {
      return 'error';
    }
  });
  const check = () => autoUpdater.checkForUpdates().catch(() => {});
  setTimeout(check, 3000);
  setInterval(check, 24 * 60 * 60 * 1000);
}

app.whenReady().then(() => {
  if (process.platform === 'darwin' && app.dock) {
    try {
      app.dock.setIcon(path.join(__dirname, '..', 'assets', 'icon-1024.png'));
    } catch (_) {}
  }
  vaultPath = loadConfig();
  ensureVault();
  registerIpc();
  createWindow();
  watchVault();
  setupAutoUpdates();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
