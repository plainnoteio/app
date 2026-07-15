require('../main.js');
const { app, BrowserWindow } = require('electron');

setTimeout(() => {
  console.log('TIMEOUT - forcing exit');
  app.exit(2);
}, 20000);

app.whenReady().then(async () => {
  await new Promise((r) => setTimeout(r, 2000));
  const win = BrowserWindow.getAllWindows()[0];
  const result = await win.webContents.executeJavaScript(`(async () => {
    try {
    const pane = panes[0];
    const welcome = notes.find((n) => n.name === 'Welcome');
    if (!welcome) return { error: 'no welcome note' };
    openNoteInPane(pane, welcome.path);
    function measure() {
      const root = pane.contentEl.getBoundingClientRect();
      const out = {};
      for (const h of pane.contentEl.querySelectorAll('h1, h2, h3')) {
        out[h.textContent.slice(0, 20)] = Math.round(h.getBoundingClientRect().top - root.top);
      }
      out.__totalHeight = Math.round(root.height);
      return out;
    }
    setPaneMode(pane, 'read');
    await new Promise((r) => setTimeout(r, 100));
    const read = measure();
    setPaneMode(pane, 'live');
    await new Promise((r) => setTimeout(r, 100));
    const live = measure();
    const bulletLine = pane.lines.findIndex((l) => l.startsWith('- Toggle'));
    const hBefore = pane.contentEl.getBoundingClientRect().height;
    activatePaneLine(pane, bulletLine, 'end');
    await new Promise((r) => setTimeout(r, 100));
    const hActive = pane.contentEl.getBoundingClientRect().height;
    return { read, live, activationDelta: Math.round(hActive - hBefore) };
    } catch (err) {
      return { error: String(err && err.stack || err) };
    }
  })()`).catch((err) => ({ execError: String(err) }));
  console.log(JSON.stringify(result, null, 2));
  app.exit(0);
});
