require('../main.js');
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
setTimeout(() => { app.exit(2); }, 20000);
app.whenReady().then(async () => {
  await new Promise((r) => setTimeout(r, 2000));
  const win = BrowserWindow.getAllWindows()[0];
  const rect = await win.webContents.executeJavaScript(`(() => {
    const row = [...document.querySelectorAll('.note-row')].find(r => r.textContent.includes('Welcome'));
    const b = row.getBoundingClientRect();
    return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) };
  })()`);
  const region = { x: 0, y: rect.y - 45, width: 300, height: 130 };

  win.webContents.sendInputEvent({ type: 'mouseMove', x: 600, y: 500 });
  await new Promise((r) => setTimeout(r, 400));
  const off = await win.webContents.capturePage(region);
  fs.writeFileSync('/tmp/row-nohover.png', off.toPNG());

  win.webContents.sendInputEvent({ type: 'mouseMove', x: rect.x + 60, y: rect.y + Math.round(rect.h / 2) });
  await new Promise((r) => setTimeout(r, 400));
  const on = await win.webContents.capturePage(region);
  fs.writeFileSync('/tmp/row-hover.png', on.toPNG());
  console.log('saved', JSON.stringify(rect));
  app.exit(0);
});
