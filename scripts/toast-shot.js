require('../app/main.js');
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
setTimeout(() => { app.exit(2); }, 15000);
app.whenReady().then(async () => {
  await new Promise((r) => setTimeout(r, 2000));
  const win = BrowserWindow.getAllWindows()[0];
  win.webContents.send('update:available', { version: '1.1.0', url: 'https://github.com/plainnoteio/app/releases' });
  await new Promise((r) => setTimeout(r, 500));
  const img = await win.capturePage({ x: 0, y: 480, width: 300, height: 340 });
  fs.writeFileSync('/tmp/toast.png', img.toPNG());
  console.log('done');
  app.exit(0);
});
