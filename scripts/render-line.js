const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 1024, height: 1024, frame: false, transparent: true, webPreferences: { offscreen: true } });
  await win.loadFile(path.join(__dirname, '..', 'assets', 'logo-line.html'));
  await new Promise((r) => setTimeout(r, 800));
  const img = await win.webContents.capturePage({ x: 0, y: 0, width: 1024, height: 1024 });
  fs.writeFileSync(path.join(__dirname, '..', 'assets', 'logo-line-1024.png'), img.toPNG());
  console.log('wrote assets/logo-line-1024.png');
  app.quit();
});
