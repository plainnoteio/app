require('../app/main.js');
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
setTimeout(() => { app.exit(2); }, 15000);
app.whenReady().then(async () => {
  await new Promise((r) => setTimeout(r, 2000));
  const win = BrowserWindow.getAllWindows()[0];
  await win.webContents.executeJavaScript(`(async () => {
    const target = notes.find(n => n.name !== 'Welcome');
    collapsed.clear();
    togglePinned(target.path);
    await new Promise(r => setTimeout(r, 100));
  })()`);
  const img = await win.webContents.capturePage({ x: 0, y: 0, width: 270, height: 320 });
  fs.writeFileSync('/tmp/pin-shot.png', img.toPNG());
  await win.webContents.executeJavaScript(`(async () => {
    const target = notes.find(n => n.name !== 'Welcome');
    togglePinned(target.path);
  })()`);
  console.log('done');
  app.exit(0);
});
