require('../app/main.js');
const { app, BrowserWindow } = require('electron');
setTimeout(() => { app.exit(2); }, 15000);
app.whenReady().then(async () => {
  await new Promise((r) => setTimeout(r, 2000));
  const win = BrowserWindow.getAllWindows()[0];
  const result = await win.webContents.executeJavaScript(`(async () => {
    const target = notes.find(n => n.name !== 'Welcome');
    const countRows = () => [...treeEl.querySelectorAll('.note-row')].map(r => r.dataset.path);
    const before = countRows();
    togglePinned(target.path);
    await new Promise(r => setTimeout(r, 100));
    const after = countRows();
    togglePinned(target.path);
    return { target: target.path, before, after };
  })()`).catch((e) => ({ error: String(e) }));
  console.log(JSON.stringify(result, null, 2));
  app.exit(0);
});
