// Captures README screenshots using a throwaway demo vault.
// Temporarily points the dev config at /tmp/plainnote-demo, restores it after.
const fs = require('fs');
const os = require('os');
const path = require('path');

const cfgFile = path.join(os.homedir(), 'Library', 'Application Support', 'Electron', 'config.json');
const backup = fs.existsSync(cfgFile) ? fs.readFileSync(cfgFile, 'utf8') : null;
const demo = '/tmp/plainnote-demo';

fs.rmSync(demo, { recursive: true, force: true });
fs.mkdirSync(path.join(demo, 'Projects'), { recursive: true });

fs.writeFileSync(path.join(demo, 'Welcome.md'), `# Welcome to Plainnote

A clean home for your thoughts. Notes live as plain markdown files on your Mac, so they are always yours.

## The basics

- Write in **markdown** — headings, lists, \`code\`, and more
- Toggle between **Edit** and **Read** with Cmd+E
- Everything saves automatically as you type

## Link your thinking

Connect notes with wikilinks, like [[Ideas]] or the [[Plainnote roadmap]]. Backlinks show every note that points here.

Tag anything with #getting-started and find it again instantly.
`);

fs.writeFileSync(path.join(demo, 'Ideas.md'), `# Ideas

- A weekly review template #ideas
- Publish the [[Reading list]] as a blog post
- Try linking every new note to the [[Welcome]] map
`);

fs.writeFileSync(path.join(demo, 'Reading list.md'), `# Reading list

1. How to Take Smart Notes — Sönke Ahrens #reading
2. The Shallows — Nicholas Carr
3. Deep Work — Cal Newport
`);

fs.writeFileSync(path.join(demo, 'Projects', 'Plainnote roadmap.md'), `# Plainnote roadmap

## Shipping next

- Quick switcher #project
- Graph view

## Done

- Wikilink autocomplete
- Split view and pinned notes
- PDF and HTML export
`);

fs.writeFileSync(cfgFile, JSON.stringify({ vaultPath: demo }, null, 2));

require('../main.js');
const { app, BrowserWindow } = require('electron');

const outDir = path.join(__dirname, '..', 'docs');
fs.mkdirSync(outDir, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function restore() {
  if (backup) fs.writeFileSync(cfgFile, backup);
  else fs.rmSync(cfgFile, { force: true });
}

setTimeout(() => { restore(); app.exit(2); }, 30000);

app.whenReady().then(async () => {
  await sleep(2200);
  const win = BrowserWindow.getAllWindows()[0];
  const js = (code) => win.webContents.executeJavaScript(code);
  const shot = async (name) => {
    const img = await win.capturePage();
    fs.writeFileSync(path.join(outDir, name + '.png'), img.toPNG());
  };

  await js(`(async () => {
    localStorage.clear();
    if (document.body.classList.contains('theme-dark')) toggleTheme();
    const w = notes.find((n) => n.name === 'Welcome');
    openNote(w.path);
  })()`);
  await sleep(400);
  await shot('hero-light');

  await js(`(async () => {
    const p2 = addSplitPane();
    const r = notes.find((n) => n.name === 'Plainnote roadmap');
    openNoteInPane(p2, r.path);
    setFocusedPane(panes[0]);
  })()`);
  await sleep(400);
  await shot('split');

  await js(`(() => {
    closePane(panes[1]);
    toggleTheme();
  })()`);
  await sleep(400);
  await shot('dark');

  restore();
  console.log('shots saved to docs/');
  app.exit(0);
});
