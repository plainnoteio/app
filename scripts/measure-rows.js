require('../main.js');
const { app, BrowserWindow } = require('electron');
setTimeout(() => { app.exit(2); }, 15000);
app.whenReady().then(async () => {
  await new Promise((r) => setTimeout(r, 2000));
  const win = BrowserWindow.getAllWindows()[0];
  const result = await win.webContents.executeJavaScript(`(() => {
    const row = document.querySelector('.note-row');
    const before = row.getBoundingClientRect().height;
    const del = row.querySelector('.row-delete');
    del.style.display = 'flex';
    const after = row.getBoundingClientRect().height;
    const cs = getComputedStyle(row);
    return { before, after, minHeight: cs.minHeight, padding: cs.padding, delHeight: del.getBoundingClientRect().height };
  })()`).catch((e) => ({ error: String(e) }));
  console.log(JSON.stringify(result));
  app.exit(0);
});
