'use strict';

const $ = (sel) => document.querySelector(sel);

let notes = []; // [{ path, name, content }]
let tree = [];
let collapsed = new Set();
let selectedFolder = '';
const saveTimers = new Map();
let lastSaveAt = 0;

const treeEl = $('#tree');
const searchEl = $('#search');
const searchResultsEl = $('#search-results');
const panesWrap = $('#panes-wrap');

/* ---------- helpers ---------- */

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function noteByPath(p) {
  return notes.find((n) => n.path === p) || null;
}

function noteByName(name) {
  const lower = name.trim().toLowerCase();
  return notes.find((n) => n.name.toLowerCase() === lower) || null;
}

function wikilinkRegex(name) {
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp('\\[\\[\\s*' + esc + '\\s*(\\|[^\\]]*)?\\]\\]', 'i');
}

const TAG_RE = /(^|[\s(>])#([A-Za-z][\w/-]*)/g;

function renderMarkdown(src) {
  let s = src.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_m, target, alias) => {
    const exists = !!noteByName(target);
    return `<a class="wikilink${exists ? '' : ' missing'}" data-target="${escapeHtml(target.trim())}">${escapeHtml((alias || target).trim())}</a>`;
  });
  s = s.replace(TAG_RE, (_m, pre, tag) => `${pre}<span class="tag" data-tag="${escapeHtml(tag)}">#${escapeHtml(tag)}</span>`);
  return window.markdown.render(s);
}

function autosize(ta) {
  ta.style.height = 'auto';
  ta.style.height = ta.scrollHeight + 'px';
}

function scheduleSave(path) {
  clearTimeout(saveTimers.get(path));
  saveTimers.set(path, setTimeout(async () => {
    const note = noteByPath(path);
    if (note) {
      await window.api.writeNote(note.path, note.content);
      lastSaveAt = Date.now();
      renderTags();
      for (const p of panes) renderBacklinks(p);
    }
  }, 400));
}

/* ---------- update toast ---------- */

window.api.onUpdateAvailable((info) => {
  if (localStorage.getItem('plainnote.skipVersion') === info.version) return;
  showUpdateToast(info);
});

window.api.onUpdateError(() => {
  const btn = document.querySelector('#update-toast .toast-update');
  if (btn) {
    btn.disabled = false;
    btn.textContent = 'Update';
  }
});

function showUpdateToast(info) {
  let toast = document.getElementById('update-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'update-toast';
    document.body.appendChild(toast);
  }
  const sb = document.getElementById('sidebar');
  toast.style.width = (sb && !document.body.classList.contains('sidebar-hidden'))
    ? (sb.offsetWidth - 24) + 'px'
    : '300px';
  toast.innerHTML = `
    <div class="toast-title">Update available</div>
    <div class="toast-body">Plainnote ${escapeHtml(info.version)} is ready. The app restarts to update.</div>
    <div class="toast-actions">
      <button class="toast-later">Later</button>
      <button class="toast-update">Update</button>
    </div>`;
  toast.querySelector('.toast-update').addEventListener('click', (e) => {
    e.target.disabled = true;
    e.target.textContent = 'Updating…';
    window.api.installUpdate();
  });
  toast.querySelector('.toast-later').addEventListener('click', () => {
    localStorage.setItem('plainnote.skipVersion', info.version);
    toast.remove();
  });
}

async function checkForUpdatesManually() {
  localStorage.removeItem('plainnote.skipVersion');
  const [result, version] = await Promise.all([
    window.api.checkForUpdates(),
    window.api.getVersion(),
  ]);
  if (result === 'update') return; // the regular update toast takes it from here
  showInfoToast(
    result === 'error' ? 'Update check failed' : 'Up to date',
    result === 'error'
      ? "Couldn't reach the update server. Try again later."
      : `Plainnote ${version} is the latest version.`
  );
}

function showInfoToast(title, body) {
  let toast = document.getElementById('update-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'update-toast';
    document.body.appendChild(toast);
  }
  const sb = document.getElementById('sidebar');
  toast.style.width = (sb && !document.body.classList.contains('sidebar-hidden'))
    ? (sb.offsetWidth - 24) + 'px'
    : '300px';
  toast.innerHTML = `
    <div class="toast-title">${escapeHtml(title)}</div>
    <div class="toast-body">${escapeHtml(body)}</div>
    <div class="toast-actions">
      <button class="toast-update">OK</button>
    </div>`;
  toast.querySelector('.toast-update').addEventListener('click', () => toast.remove());
}

window.api.onVaultChanged(() => {
  if (Date.now() - lastSaveAt < 1500) return;
  refreshAll();
});

/* ---------- panes ---------- */

const panes = [];
let focusedPane = null;
const DRAG_TYPE = 'text/plainnote-path';

const SPLIT_ICON = '<svg width="13" height="13" viewBox="0 0 15 15"><rect x="1.5" y="2.5" width="12" height="10" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.2"/><line x1="7.5" y1="2.5" x2="7.5" y2="12.5" stroke="currentColor" stroke-width="1.2"/></svg>';
const CLOSE_ICON = '<svg width="12" height="12" viewBox="0 0 15 15"><path d="M3.5 3.5l8 8M11.5 3.5l-8 8" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>';
const GEAR_ICON = '<svg width="14" height="14" viewBox="0 0 24 24"><circle cx="12" cy="12" r="3.4" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h.09a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v.09a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>';
const MOON_ICON = '<svg width="14" height="14" viewBox="0 0 24 24"><path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>';
const SUN_ICON = '<svg width="14" height="14" viewBox="0 0 24 24"><circle cx="12" cy="12" r="4" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';

function createPane() {
  const pane = { path: null, mode: 'live', lines: [''], units: [{ start: 0, end: 0 }], active: null, deactivateTimer: null, history: [], histIndex: -1 };
  const el = document.createElement('section');
  el.className = 'pane mode-live';
  el.innerHTML = `
    <div class="pane-header">
      <div class="pane-header-spacer"></div>
      <div class="pane-mode">
        <button data-mode="live" class="active">Edit</button>
        <button data-mode="read">Read</button>
      </div>
      <button class="btn-icon pane-split" title="Open a second note side by side">${SPLIT_ICON}</button>
      <button class="btn-icon pane-close" title="Close this pane">${CLOSE_ICON}</button>
    </div>
    <div class="pane-scroll">
      <input class="pane-inline-title" spellcheck="false" autocomplete="off" />
      <div class="pane-content markdown"></div>
      <div class="pane-backlinks">
        <div class="section-label">Backlinks</div>
        <div class="backlinks-list"></div>
      </div>
    </div>
    <div class="pane-empty">
      <div class="empty-inner">
        <div class="empty-mark">✏️</div>
        <p>Drop a note here, or pick one from the sidebar</p>
        <button class="btn-empty-new">Create a note</button>
      </div>
    </div>`;
  pane.el = el;
  pane.inlineTitleEl = el.querySelector('.pane-inline-title');
  pane.contentEl = el.querySelector('.pane-content');
  pane.scrollEl = el.querySelector('.pane-scroll');
  pane.backlinksEl = el.querySelector('.backlinks-list');
  pane.emptyEl = el.querySelector('.pane-empty');

  el.addEventListener('mousedown', () => setFocusedPane(pane));

  pane.inlineTitleEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); pane.inlineTitleEl.blur(); }
  });
  pane.inlineTitleEl.addEventListener('blur', () => commitRename(pane, pane.inlineTitleEl));

  el.querySelector('.pane-mode').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (b) setPaneMode(pane, b.dataset.mode);
  });
  el.querySelector('.pane-split').addEventListener('click', () => addSplitPane());
  el.querySelector('.pane-close').addEventListener('click', () => closePane(pane));
  el.querySelector('.btn-empty-new').addEventListener('click', () => {
    setFocusedPane(pane);
    createNewNote();
  });

  pane.scrollEl.addEventListener('click', (e) => handleRenderedClick(pane, e));

  // Clicks in the gaps between lines (margins) land on the container — send them to the nearest line
  pane.contentEl.addEventListener('click', (e) => {
    if (pane.mode !== 'live' || e.target !== pane.contentEl) return;
    const sel = window.getSelection();
    if (sel && !sel.isCollapsed) return;
    const kids = [...pane.contentEl.children];
    if (!kids.length) return;
    setFocusedPane(pane);
    let best = 0;
    let bestDist = Infinity;
    kids.forEach((k, idx) => {
      const r = k.getBoundingClientRect();
      const mid = (r.top + r.bottom) / 2;
      const d = Math.abs(e.clientY - mid);
      if (d < bestDist) { bestDist = d; best = idx; }
    });
    activatePaneUnit(pane, best, 'end');
  });

  // Clicks below the note body focus its last line
  pane.scrollEl.addEventListener('click', (e) => {
    if (pane.mode !== 'live' || e.target !== pane.scrollEl) return;
    if (!noteByPath(pane.path)) return;
    const sel = window.getSelection();
    if (sel && !sel.isCollapsed) return;
    setFocusedPane(pane);
    activatePaneUnit(pane, pane.units.length - 1, 'end');
  });

  el.addEventListener('dragover', (e) => {
    if (!e.dataTransfer.types.includes(DRAG_TYPE)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    el.classList.add('drop-target');
  });
  el.addEventListener('dragleave', (e) => {
    if (!el.contains(e.relatedTarget)) el.classList.remove('drop-target');
  });
  el.addEventListener('drop', (e) => {
    if (!e.dataTransfer.types.includes(DRAG_TYPE)) return;
    e.preventDefault();
    e.stopPropagation();
    el.classList.remove('drop-target');
    const src = e.dataTransfer.getData(DRAG_TYPE);
    if (!src) return;
    if (panes.length === 1 && pane.path && pane.path !== src) {
      const p2 = addSplitPane();
      openNoteInPane(p2, src);
    } else {
      openNoteInPane(pane, src);
    }
  });

  return pane;
}

function setFocusedPane(pane) {
  focusedPane = pane;
  for (const p of panes) p.el.classList.toggle('focused', p === pane);
  updateTreeHighlight();
}

function updatePaneChrome() {
  for (const p of panes) {
    p.el.querySelector('.pane-split').style.display = panes.length === 1 ? '' : 'none';
    p.el.querySelector('.pane-close').style.display = panes.length > 1 ? '' : 'none';
  }
}

let paneDivider = null;
let splitRatio = parseFloat(localStorage.getItem('plainnote.splitRatio') || '0.5') || 0.5;

function applySplitRatio() {
  if (panes.length < 2) return;
  panes[0].el.style.flex = `0 0 ${(splitRatio * 100).toFixed(1)}%`;
  panes[1].el.style.flex = '1';
}

function addSplitPane() {
  if (panes.length >= 2) return panes[1];
  const p = createPane();
  panes.push(p);

  paneDivider = document.createElement('div');
  paneDivider.className = 'pane-divider';
  paneDivider.title = 'Drag to resize';
  let dividerDrag = false;
  paneDivider.addEventListener('mousedown', (e) => {
    dividerDrag = true;
    paneDivider.classList.add('dragging');
    e.preventDefault();
  });
  document.addEventListener('mousemove', (e) => {
    if (!dividerDrag) return;
    const r = panesWrap.getBoundingClientRect();
    splitRatio = Math.max(0.2, Math.min(0.8, (e.clientX - r.left) / r.width));
    applySplitRatio();
  });
  document.addEventListener('mouseup', () => {
    if (dividerDrag) {
      dividerDrag = false;
      paneDivider.classList.remove('dragging');
      localStorage.setItem('plainnote.splitRatio', String(splitRatio));
    }
  });

  panesWrap.appendChild(paneDivider);
  panesWrap.appendChild(p.el);
  renderPane(p);
  applyInlineTitle();
  applyTheme();
  applySplitRatio();
  updatePaneChrome();
  setFocusedPane(p);
  return p;
}

function closePane(pane) {
  if (panes.length === 1) return;
  const idx = panes.indexOf(pane);
  pane.el.remove();
  panes.splice(idx, 1);
  if (paneDivider) {
    paneDivider.remove();
    paneDivider = null;
  }
  panes[0].el.style.flex = '';
  updatePaneChrome();
  setFocusedPane(panes[0]);
}

function setPaneMode(pane, mode) {
  pane.mode = mode;
  pane.el.classList.remove('mode-live', 'mode-read');
  pane.el.classList.add('mode-' + mode);
  for (const b of pane.el.querySelectorAll('.pane-mode button')) {
    b.classList.toggle('active', b.dataset.mode === mode);
  }
  if (mode === 'live') enterLivePane(pane);
  else renderPane(pane);
}

function openNoteInPane(pane, path, fromHistory) {
  const note = noteByPath(path);
  if (!note) return;
  if (!fromHistory && pane.history[pane.histIndex] !== path) {
    pane.history = pane.history.slice(0, pane.histIndex + 1);
    pane.history.push(path);
    pane.histIndex = pane.history.length - 1;
  }
  pane.path = path;
  selectedFolder = path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '';
  pane.inlineTitleEl.value = note.name;
  if (pane.mode === 'live') enterLivePane(pane);
  else renderPane(pane);
  renderBacklinks(pane);
  updateTreeHighlight();
}

function openNote(path) {
  const pane = focusedPane || panes[0];
  setFocusedPane(pane);
  openNoteInPane(pane, path);
  searchEl.value = '';
  runSearch();
}

function paneGoBack(pane) {
  let i = pane.histIndex - 1;
  while (i >= 0 && !noteByPath(pane.history[i])) i--;
  if (i < 0) return;
  pane.histIndex = i;
  openNoteInPane(pane, pane.history[i], true);
}

function paneGoForward(pane) {
  let i = pane.histIndex + 1;
  while (i < pane.history.length && !noteByPath(pane.history[i])) i++;
  if (i >= pane.history.length) return;
  pane.histIndex = i;
  openNoteInPane(pane, pane.history[i], true);
}

function paneFromEvent(e) {
  const el = e.target && e.target.closest ? e.target.closest('.pane') : null;
  return panes.find((p) => p.el === el) || focusedPane || panes[0];
}

document.addEventListener('mouseup', (e) => {
  if (e.button === 3 || e.button === 4) {
    e.preventDefault();
    const pane = paneFromEvent(e);
    if (e.button === 3) paneGoBack(pane);
    else paneGoForward(pane);
  }
});
document.addEventListener('mousedown', (e) => {
  if (e.button === 3 || e.button === 4) e.preventDefault();
});

function updateTreeHighlight() {
  const open = new Set(panes.map((p) => p.path).filter(Boolean));
  for (const row of treeEl.querySelectorAll('.note-row')) {
    row.classList.toggle('active', focusedPane && row.dataset.path === focusedPane.path);
    row.classList.toggle('open-elsewhere', open.has(row.dataset.path) && (!focusedPane || row.dataset.path !== focusedPane.path));
  }
}

/* ---------- pane rendering (live + read) ---------- */

function renderPane(pane) {
  const note = noteByPath(pane.path);
  pane.emptyEl.style.display = note ? 'none' : 'flex';
  pane.scrollEl.style.display = note ? '' : 'none';
  pane.el.querySelector('.pane-header').style.visibility = note ? '' : 'hidden';
  if (!note) {
    pane.contentEl.innerHTML = '';
    return;
  }
  if (pane.mode === 'read') {
    pane.contentEl.innerHTML = renderMarkdown(note.content);
    refreshFindFor(pane);
    return;
  }

  pane.contentEl.innerHTML = '';
  if (pane.lines.length === 1 && pane.lines[0].trim() === '' && pane.active === null) {
    const hint = document.createElement('div');
    hint.className = 'live-hint';
    hint.textContent = 'Click to start writing…';
    hint.addEventListener('mousedown', (e) => {
      e.preventDefault();
      activatePaneLine(pane, 0, 0);
    });
    pane.contentEl.appendChild(hint);
    return;
  }
  pane.units.forEach((u, ui) => {
    const text = pane.lines.slice(u.start, u.end + 1).join('\n');
    if (ui === pane.active) {
      const ta = document.createElement('textarea');
      ta.className = 'live-editor';
      ta.rows = 1;
      ta.value = text;
      ta._activatedValue = text; // if still equal, user hasn't typed → Cmd+Z undoes the note
      wirePaneEditor(pane, ta, ui);
      const wrap = document.createElement('div');
      wrap.className = 'live-edit-wrap';
      const whm = text.match(/^(#{1,6})\s/);
      if (whm) wrap.classList.add('live-h' + Math.min(whm[1].length, 3));
      // Match the rendered block box so text doesn't jump on activation (code <pre>, quote border).
      const firstLine = text.split('\n', 1)[0];
      if (/^(```|~~~)/.test(firstLine.trim()) || /^(    |\t)/.test(firstLine)) {
        wrap.classList.add('live-edit-code');
      } else if (/^\s*>/.test(firstLine)) {
        wrap.classList.add('live-edit-quote');
      }
      wrap.dataset.ln = u.start + 1;
      wrap.appendChild(ta);
      pane.contentEl.appendChild(wrap);
      liveEditorStyle(ta);
      requestAnimationFrame(() => autosize(ta));
    } else {
      pane.contentEl.appendChild(buildLineEl(pane, u));
    }
  });
  refreshFindFor(pane);
}

function buildLineEl(pane, u) {
  const text = pane.lines.slice(u.start, u.end + 1).join('\n');
  const div = document.createElement('div');
  div.className = 'live-line';
  div.dataset.ln = u.start + 1;
  if (text.trim() === '') {
    div.classList.add('blank');
  } else {
    const hm = text.match(/^(#{1,6})\s/);
    if (hm) div.classList.add('live-h', 'live-h' + Math.min(hm[1].length, 3));
    div.innerHTML = renderMarkdown(text);
  }
  div.addEventListener('click', (e) => {
    if (e.target.closest('a, .tag')) return;
    const sel = window.getSelection();
    if (sel && !sel.isCollapsed) return;
    activatePaneLine(pane, parseInt(div.dataset.ln, 10) - 1, 'end');
  });
  return div;
}

function refreshFindFor(pane) {
  if (!findState || findState.pane !== pane || !findState.query) return;
  findState.marks = markMatches(pane.contentEl, findState.query);
  if (!findState.marks.length) {
    findState.cur = -1;
  } else {
    findState.cur = Math.max(0, Math.min(findState.cur, findState.marks.length - 1));
    findState.marks.forEach((m, i) => m.classList.toggle('cur', i === findState.cur));
  }
  updateFindCount();
}

function buildUnits(lines) {
  const units = [];
  let i = 0;
  while (i < lines.length) {
    if (/^(```|~~~)/.test(lines[i].trim())) {
      let j = i + 1;
      while (j < lines.length && !/^(```|~~~)/.test(lines[j].trim())) j++;
      const end = Math.min(j, lines.length - 1);
      units.push({ start: i, end });
      i = end + 1;
    } else {
      units.push({ start: i, end: i });
      i++;
    }
  }
  if (units.length === 0) units.push({ start: 0, end: 0 });
  return units;
}

function enterLivePane(pane) {
  const note = noteByPath(pane.path);
  pane.lines = note ? note.content.split('\n') : [''];
  if (pane.lines.length === 0) pane.lines = [''];
  pane.units = buildUnits(pane.lines);
  pane.active = null;
  renderPane(pane);
}

const undoStacks = new Map();

function pushUndo(path, prevContent, force) {
  let st = undoStacks.get(path);
  if (!st) {
    st = { stack: [], redo: [], last: 0 };
    undoStacks.set(path, st);
  }
  // Typing coalesces to one checkpoint per 800ms; discrete edits pass force.
  if (!force && Date.now() - st.last < 800) return;
  if (st.stack[st.stack.length - 1] === prevContent) return;
  st.stack.push(prevContent);
  if (st.stack.length > 200) st.stack.shift();
  st.redo = [];
  st.last = Date.now();
}

function applyContentToPanes(note) {
  for (const p of panes) {
    if (p.path !== note.path) continue;
    if (p.mode === 'live') {
      p.lines = note.content.split('\n');
      p.units = buildUnits(p.lines);
      p.active = null;
    }
    renderPane(p);
    renderBacklinks(p);
  }
}

function undoPane(pane) {
  const note = noteByPath(pane.path);
  if (!note) return;
  const st = undoStacks.get(note.path);
  if (!st || !st.stack.length) return;
  st.redo.push(note.content);
  note.content = st.stack.pop();
  st.last = 0;
  applyContentToPanes(note);
  scheduleSave(note.path);
}

function redoPane(pane) {
  const note = noteByPath(pane.path);
  if (!note) return;
  const st = undoStacks.get(note.path);
  if (!st || !st.redo.length) return;
  st.stack.push(note.content);
  note.content = st.redo.pop();
  st.last = 0;
  applyContentToPanes(note);
  scheduleSave(note.path);
}

function syncPane(pane) {
  const note = noteByPath(pane.path);
  if (!note) return;
  const newContent = pane.lines.join('\n');
  if (newContent !== note.content) pushUndo(note.path, note.content);
  note.content = newContent;
  scheduleSave(note.path);
  for (const p of panes) {
    if (p !== pane && p.path === pane.path) {
      if (p.mode === 'live') {
        p.lines = note.content.split('\n');
        p.units = buildUnits(p.lines);
        p.active = null;
      }
      renderPane(p);
    }
  }
}

function activatePaneUnit(pane, ui, caret) {
  clearTimeout(pane.deactivateTimer);
  pane.active = ui;
  renderPane(pane);
  const ta = pane.contentEl.querySelector('.live-editor');
  if (!ta) return;
  ta.focus();
  const pos = caret === 'end' ? ta.value.length : (typeof caret === 'number' ? Math.min(caret, ta.value.length) : 0);
  ta.setSelectionRange(pos, pos);
  autosize(ta);
}

function activatePaneLine(pane, lineIdx, caret) {
  pane.units = buildUnits(pane.lines);
  let ui = pane.units.findIndex((u) => lineIdx >= u.start && lineIdx <= u.end);
  if (ui === -1) ui = pane.units.length - 1;
  activatePaneUnit(pane, ui, caret);
}

function deactivatePane(pane) {
  const wrap = pane.contentEl.querySelector('.live-edit-wrap');
  const ln = wrap ? parseInt(wrap.dataset.ln, 10) - 1 : -1;
  pane.active = null;
  pane.units = buildUnits(pane.lines);
  syncPane(pane);
  const empty = pane.lines.length === 1 && pane.lines[0].trim() === '';
  if (wrap && ln >= 0 && !empty) {
    // Replace only the edited line so a text selection being dragged elsewhere survives
    const u = pane.units.find((x) => ln >= x.start && ln <= x.end) || pane.units[pane.units.length - 1];
    wrap.replaceWith(buildLineEl(pane, u));
    refreshFindFor(pane);
  } else {
    renderPane(pane);
  }
}

/* ---------- live-mode selection editing (edits a selection over rendered lines) ---------- */

function liveLineEl(pane, node) {
  const host = node.nodeType === 3 ? node.parentElement : node;
  const lineEl = host && host.closest ? host.closest('.live-line') : null;
  if (!lineEl || !pane.contentEl.contains(lineEl)) return null;
  return lineEl;
}

// Exact source column when the line maps 1:1, else null.
function livePointToSource(pane, node, offset) {
  const lineEl = liveLineEl(pane, node);
  if (!lineEl) return null;
  const ln = parseInt(lineEl.dataset.ln, 10) - 1;
  const u = pane.units.find((x) => ln >= x.start && ln <= x.end);
  if (!u) return null;
  const src = pane.lines.slice(u.start, u.end + 1).join('\n');
  let rendered = lineEl.textContent;
  if (rendered.endsWith('\n')) rendered = rendered.slice(0, -1);
  if (rendered !== src) return null; // not 1:1 mappable — don't risk corrupting it
  const r = document.createRange();
  r.selectNodeContents(lineEl);
  try { r.setEnd(node, offset); } catch (_) { return null; }
  return { line: u.start, col: Math.min(r.toString().length, src.length) };
}

// Exact {line, col} on a 1:1 line, else the formatted line's unit + start/end flags.
function liveBoundary(pane, node, offset) {
  const exact = livePointToSource(pane, node, offset);
  if (exact) return { line: exact.line, col: exact.col, exact: true };
  const lineEl = liveLineEl(pane, node);
  if (!lineEl) return null;
  const ln = parseInt(lineEl.dataset.ln, 10) - 1;
  const u = pane.units.find((x) => ln >= x.start && ln <= x.end);
  if (!u) return null;
  let rendered = lineEl.textContent;
  if (rendered.endsWith('\n')) rendered = rendered.slice(0, -1);
  const r = document.createRange();
  r.selectNodeContents(lineEl);
  let col = 0;
  try { r.setEnd(node, offset); col = r.toString().length; } catch (_) { col = 0; }
  if (u.start === u.end) {
    const src = pane.lines[u.start];
    const mk = src.match(/^(\s*(?:#{1,6} |[-*+] |\d+[.)] |> ?))([\s\S]*)$/);
    if (mk && mk[2].length && rendered.trim() === mk[2]) {
      const rc = col - (rendered.length - rendered.trimStart().length); // drop wrapper's leading newline
      return { line: u.start, col: rc <= 0 ? 0 : Math.min(mk[1].length + rc, src.length), exact: true };
    }
  }
  return { unit: u, atStart: col <= 0, atEnd: col >= rendered.length, exact: false };
}

function resolveLiveRange(pane, range) {
  const a = liveBoundary(pane, range.startContainer, range.startOffset);
  const b = liveBoundary(pane, range.endContainer, range.endOffset);
  if (!a || !b) return null;
  let aLine, aCol, bLine, bCol;
  if (a.exact) {
    aLine = a.line; aCol = a.col;
  } else if (a.atEnd) {
    aLine = a.unit.end; aCol = pane.lines[a.unit.end].length; // starts at line end — keep it
  } else {
    aLine = a.unit.start; aCol = 0; // formatted line touched — take it in full
  }
  if (b.exact) {
    bLine = b.line; bCol = b.col;
  } else if (b.atStart) {
    bLine = b.unit.start; bCol = 0; // ends at line start — keep it
  } else {
    bLine = b.unit.end; bCol = pane.lines[b.unit.end].length;
  }
  if (aLine > bLine || (aLine === bLine && aCol >= bCol)) return null; // snapped to empty
  return { aLine, aCol, bLine, bCol };
}

// Source markdown under a rendered selection (so copy/cut round-trips, not the mangled DOM text).
function liveSelectionText(pane, range) {
  const r = resolveLiveRange(pane, range);
  if (!r) return null;
  if (r.aLine === r.bLine) return pane.lines[r.aLine].slice(r.aCol, r.bCol);
  const parts = [pane.lines[r.aLine].slice(r.aCol)];
  for (let i = r.aLine + 1; i < r.bLine; i++) parts.push(pane.lines[i]);
  parts.push(pane.lines[r.bLine].slice(0, r.bCol));
  return parts.join('\n');
}

function deleteLiveRange(pane, r) {
  const note = noteByPath(pane.path);
  if (note) pushUndo(note.path, note.content, true); // one undo point for the edit
  const prefix = pane.lines[r.aLine].slice(0, r.aCol);
  const suffix = pane.lines[r.bLine].slice(r.bCol);
  const merged = (prefix + suffix).split('\n');
  pane.lines.splice(r.aLine, r.bLine - r.aLine + 1, ...merged);
  syncPane(pane);
  activatePaneLine(pane, r.aLine, prefix.length);
}

function liveSelectionEdit(pane, e) {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return false;
  const range = sel.getRangeAt(0);
  if (!pane.contentEl.contains(range.startContainer) || !pane.contentEl.contains(range.endContainer)) return false;

  const key = e.key;
  const plain = !e.metaKey && !e.ctrlKey && !e.altKey;
  const isDelete = plain && (key === 'Backspace' || key === 'Delete');
  const isEnter = plain && key === 'Enter';
  const isChar = plain && key.length === 1;
  if (!isDelete && !isEnter && !isChar) return false;

  const r = resolveLiveRange(pane, range);
  if (!r) return false;
  e.preventDefault();
  e.stopPropagation();
  if (isDelete) { deleteLiveRange(pane, r); return true; }

  const { aLine, aCol, bLine, bCol } = r;
  const prefix = pane.lines[aLine].slice(0, aCol);
  const suffix = pane.lines[bLine].slice(bCol);
  const note = noteByPath(pane.path);
  if (note) pushUndo(note.path, note.content, true);

  if (isEnter) {
    pane.lines.splice(aLine, bLine - aLine + 1, prefix, suffix);
    syncPane(pane);
    activatePaneLine(pane, aLine + 1, 0);
    return true;
  }
  const merged = (prefix + key + suffix).split('\n');
  pane.lines.splice(aLine, bLine - aLine + 1, ...merged);
  syncPane(pane);
  activatePaneLine(pane, aLine, (prefix + key).length);
  return true;
}

// Cmd+C / Cmd+X over rendered lines: put source markdown on the clipboard (native
// copy would serialize the rendered DOM — losing '#' markers, adding blank lines).
function liveClipboard(pane, e, isCut) {
  const ae = document.activeElement;
  if (ae && ae.tagName === 'INPUT') return false; // search / find fields use native copy
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return false;
  const range = sel.getRangeAt(0);
  if (!pane.contentEl.contains(range.startContainer) || !pane.contentEl.contains(range.endContainer)) return false;
  const r = resolveLiveRange(pane, range);
  if (!r) return false;
  const text = liveSelectionText(pane, range);
  e.preventDefault();
  e.clipboardData.setData('text/plain', text);
  if (isCut) deleteLiveRange(pane, r);
  return true;
}

function liveEditorStyle(ta) {
  const wrap = ta.parentElement;
  if (wrap && wrap.classList.contains('live-edit-code')) {
    // The wrap replicates the <pre> box; the textarea just holds monospace text.
    ta.style.fontSize = '';
    ta.style.fontWeight = '';
    ta.style.lineHeight = '';
    ta.style.marginTop = '';
    ta.style.marginBottom = '';
    ta.style.paddingLeft = '';
    ta.style.fontFamily = 'ui-monospace, "SF Mono", Menlo, monospace';
    return;
  }
  const first = ta.value.split('\n', 1)[0];
  const m = first.match(/^(#{1,6})\s/);
  if (m) {
    const sizes = { 1: '1.6rem', 2: '1.3rem', 3: '1.1rem' };
    ta.style.fontSize = sizes[Math.min(m[1].length, 3)];
    ta.style.fontWeight = '700';
    ta.style.lineHeight = '1.35';
    ta.style.fontFamily = '';
    ta.style.paddingLeft = '';
    const level = Math.min(m[1].length, 3);
    ta.style.marginTop = lineNumbersOn ? '' : (level === 1 ? '1.68rem' : (level === 2 ? '1.26rem' : '0.98rem'));
    ta.style.marginBottom = lineNumbersOn ? '' : (level === 1 ? '0.24rem' : '');
    return;
  }
  ta.style.fontSize = '';
  ta.style.fontWeight = '';
  ta.style.lineHeight = '';
  ta.style.marginTop = '';
  ta.style.marginBottom = '';
  ta.style.fontFamily = /^(```|~~~|    )/.test(first) ? 'ui-monospace, "SF Mono", Menlo, monospace' : '';
  ta.style.paddingLeft = /^\s*([-*+]|\d+[.)])\s/.test(first) ? '20px' : '';
}

/* ---------- find in note (Cmd+F) ---------- */

let findState = null;

const findBar = document.createElement('div');
findBar.id = 'findbar';
findBar.innerHTML = `
  <input spellcheck="false" autocomplete="off" placeholder="Find in note…">
  <span class="find-count"></span>
  <button class="find-prev" title="Previous match"><svg width="12" height="12" viewBox="0 0 24 24"><path d="M6 15l6-6 6 6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
  <button class="find-next" title="Next match"><svg width="12" height="12" viewBox="0 0 24 24"><path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
  <button class="find-close" title="Close"><svg width="11" height="11" viewBox="0 0 24 24"><path d="M5 5l14 14M19 5L5 19" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg></button>`;
const findInput = findBar.querySelector('input');
const findCount = findBar.querySelector('.find-count');

function clearFindMarks(root) {
  for (const m of root.querySelectorAll('mark.find-hit')) {
    m.replaceWith(document.createTextNode(m.textContent));
  }
  root.normalize();
}

function markMatches(root, q) {
  const ql = q.toLowerCase();
  const marks = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const textNodes = [];
  let n;
  while ((n = walker.nextNode())) textNodes.push(n);
  for (const node of textNodes) {
    const text = node.nodeValue;
    const lower = text.toLowerCase();
    let idx = lower.indexOf(ql);
    if (idx === -1) continue;
    const frag = document.createDocumentFragment();
    let last = 0;
    while (idx !== -1) {
      frag.append(text.slice(last, idx));
      const mark = document.createElement('mark');
      mark.className = 'find-hit';
      mark.textContent = text.slice(idx, idx + q.length);
      frag.append(mark);
      marks.push(mark);
      last = idx + q.length;
      idx = lower.indexOf(ql, last);
    }
    frag.append(text.slice(last));
    node.replaceWith(frag);
  }
  return marks;
}

function updateFindCount() {
  if (!findState) return;
  findCount.textContent = findState.marks.length
    ? `${findState.cur + 1}/${findState.marks.length}`
    : (findState.query ? '0' : '');
}

function focusFindMark() {
  findState.marks.forEach((m, i) => m.classList.toggle('cur', i === findState.cur));
  const m = findState.marks[findState.cur];
  if (m) m.scrollIntoView({ block: 'center' });
  updateFindCount();
}

function runFind() {
  const { pane, query } = findState;
  clearFindMarks(pane.contentEl);
  findState.marks = [];
  findState.cur = -1;
  if (query) {
    findState.marks = markMatches(pane.contentEl, query);
    if (findState.marks.length) {
      findState.cur = 0;
      focusFindMark();
    }
  }
  updateFindCount();
}

function stepFind(dir) {
  if (!findState || !findState.marks.length) return;
  findState.cur = (findState.cur + dir + findState.marks.length) % findState.marks.length;
  focusFindMark();
}

function openFind() {
  const pane = focusedPane || panes[0];
  if (!noteByPath(pane.path)) return;
  if (findState && findState.pane === pane) {
    findInput.focus();
    findInput.select();
    return;
  }
  closeFind();
  findState = { pane, query: '', marks: [], cur: -1 };
  pane.el.appendChild(findBar);
  findBar.style.display = 'flex';
  findInput.value = '';
  updateFindCount();
  findInput.focus();
}

function closeFind() {
  if (!findState) return;
  clearFindMarks(findState.pane.contentEl);
  findBar.style.display = 'none';
  findBar.remove();
  findState = null;
}

findInput.addEventListener('input', () => {
  if (!findState) return;
  findState.query = findInput.value;
  runFind();
});
findInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); stepFind(e.shiftKey ? -1 : 1); }
  if (e.key === 'Escape') { e.preventDefault(); closeFind(); }
});
findBar.querySelector('.find-prev').addEventListener('click', () => stepFind(-1));
findBar.querySelector('.find-next').addEventListener('click', () => stepFind(1));
findBar.querySelector('.find-close').addEventListener('click', closeFind);

/* ---------- wikilink autocomplete ---------- */

const suggestEl = document.createElement('div');
suggestEl.id = 'wikisuggest';
suggestEl.style.display = 'none';
document.body.appendChild(suggestEl);
let suggest = null;

function hideSuggest() {
  suggest = null;
  suggestEl.style.display = 'none';
}

function updateWikiSuggest(pane, ta) {
  const pos = ta.selectionStart;
  const before = ta.value.slice(0, pos);
  const m = before.match(/\[\[([^\[\]|]*)$/);
  if (!m) return hideSuggest();
  const q = m[1].toLowerCase();
  const items = notes
    .filter((n) => n.path !== pane.path && n.name.toLowerCase().includes(q))
    .sort((a, b) => a.name.toLowerCase().indexOf(q) - b.name.toLowerCase().indexOf(q))
    .slice(0, 6);
  if (!items.length) return hideSuggest();
  suggest = { ta, pane, items, sel: 0, qlen: m[1].length };
  renderSuggest();
}

function renderSuggest() {
  suggestEl.innerHTML = '';
  suggest.items.forEach((n, i) => {
    const row = document.createElement('div');
    row.className = 'menu-item' + (i === suggest.sel ? ' sel' : '');
    row.textContent = n.name;
    row.addEventListener('mousedown', (e) => {
      e.preventDefault();
      suggest.sel = i;
      acceptSuggest();
    });
    suggestEl.appendChild(row);
  });
  const r = suggest.ta.getBoundingClientRect();
  suggestEl.style.display = 'block';
  const beforeText = suggest.ta.value.slice(0, suggest.ta.selectionStart);
  const lastLine = beforeText.slice(beforeText.lastIndexOf('\n') + 1);
  const ctx = renderSuggest._ctx || (renderSuggest._ctx = document.createElement('canvas').getContext('2d'));
  ctx.font = getComputedStyle(suggest.ta).font;
  let x = r.left + 10 + ctx.measureText(lastLine).width;
  x = Math.max(8, Math.min(x, window.innerWidth - suggestEl.offsetWidth - 12));
  let y = r.bottom + 2;
  if (y + suggestEl.offsetHeight > window.innerHeight - 8) y = r.top - suggestEl.offsetHeight - 2;
  suggestEl.style.left = x + 'px';
  suggestEl.style.top = y + 'px';
}

function acceptSuggest() {
  const { ta, items, sel, qlen } = suggest;
  const name = items[sel].name;
  const pos = ta.selectionStart;
  const after = ta.value.slice(ta.selectionEnd);
  const closing = after.startsWith(']]') ? '' : ']]';
  ta.value = ta.value.slice(0, pos - qlen) + name + closing + after;
  const np = pos - qlen + name.length + 2;
  ta.setSelectionRange(np, np);
  hideSuggest();
  ta.dispatchEvent(new Event('input'));
}

// Line/col of an absolute character offset within a set of lines.
function offsetToLineCol(lines, offset) {
  let o = offset;
  for (let i = 0; i < lines.length; i++) {
    if (o <= lines[i].length) return { line: i, col: o };
    o -= lines[i].length + 1;
  }
  const last = lines.length - 1;
  return { line: last, col: lines[last].length };
}

function wirePaneEditor(pane, ta, ui) {
  const unit = pane.units[ui];
  const isFence = () => /^(```|~~~)/.test((ta.value.trim().split('\n')[0] || ''));

  ta.addEventListener('input', () => {
    const newLines = ta.value.split('\n');
    pane.lines.splice(unit.start, unit.end - unit.start + 1, ...newLines);
    unit.end = unit.start + newLines.length - 1;
    liveEditorStyle(ta);
    autosize(ta);
    syncPane(pane);
    updateWikiSuggest(pane, ta);
  });

  // Paste of multiple lines: split into separate lines so they render, keeping
  // only the caret's line active — otherwise the whole block stays one raw unit.
  ta.addEventListener('paste', (e) => {
    const text = (e.clipboardData ? e.clipboardData.getData('text/plain') : '').replace(/\r\n?/g, '\n');
    if (!text.includes('\n')) return; // single line: let the native paste + input run
    e.preventDefault();
    const before = ta.value.slice(0, ta.selectionStart);
    const after = ta.value.slice(ta.selectionEnd);
    const merged = (before + text + after).split('\n');
    const caret = offsetToLineCol(merged, (before + text).length);
    const note = noteByPath(pane.path);
    if (note) pushUndo(note.path, note.content, true);
    pane.lines.splice(unit.start, unit.end - unit.start + 1, ...merged);
    syncPane(pane);
    activatePaneLine(pane, unit.start + caret.line, caret.col);
  });

  ta.addEventListener('blur', () => {
    hideSuggest();
    pane.deactivateTimer = setTimeout(() => {
      if (pane.active === ui) deactivatePane(pane);
    }, 120);
  });

  ta.addEventListener('keydown', (e) => {
    const val = ta.value;
    const pos = ta.selectionStart;
    const collapsed = ta.selectionStart === ta.selectionEnd;

    if (suggest && suggest.ta === ta) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        suggest.sel = (suggest.sel + 1) % suggest.items.length;
        renderSuggest();
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        suggest.sel = (suggest.sel - 1 + suggest.items.length) % suggest.items.length;
        renderSuggest();
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        acceptSuggest();
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        hideSuggest();
        return;
      }
    }

    if (e.key === 'Escape') {
      e.preventDefault();
      ta.blur();
      return;
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      if (isFence()) return;
      e.preventDefault();
      const before = val.slice(0, pos);
      const after = val.slice(ta.selectionEnd);
      const m = before.match(/^(\s*)([-*+] |\d+[.)] |> ?)(.*)$/);
      if (m && m[3].trim() === '' && after.trim() === '') {
        pane.lines[unit.start] = '';
        syncPane(pane);
        activatePaneLine(pane, unit.start, 0);
        return;
      }
      let newLine = after;
      let caretPos = 0;
      if (m && m[3].trim() !== '') {
        let marker = m[2];
        const num = marker.match(/^(\d+)([.)] )$/);
        if (num) marker = (parseInt(num[1], 10) + 1) + num[2];
        newLine = m[1] + marker + after;
        caretPos = (m[1] + marker).length;
      }
      pane.lines[unit.start] = before;
      pane.lines.splice(unit.start + 1, 0, newLine);
      syncPane(pane);
      activatePaneLine(pane, unit.start + 1, caretPos);
      return;
    }

    if (e.key === 'Backspace' && collapsed && pos === 0 && unit.start > 0 && !isFence()) {
      e.preventDefault();
      const prevLine = pane.lines[unit.start - 1];
      pane.lines.splice(unit.start - 1, 2, prevLine + val);
      syncPane(pane);
      activatePaneLine(pane, unit.start - 1, prevLine.length);
      return;
    }

    if (e.key === 'ArrowUp' && collapsed) {
      if (val.lastIndexOf('\n', pos - 1) === -1 && unit.start > 0) {
        e.preventDefault();
        activatePaneLine(pane, unit.start - 1, pos);
      }
      return;
    }

    if (e.key === 'ArrowDown' && collapsed) {
      if (val.indexOf('\n', pos) === -1 && unit.end < pane.lines.length - 1) {
        e.preventDefault();
        const col = pos - (val.lastIndexOf('\n', pos - 1) + 1);
        activatePaneLine(pane, unit.end + 1, col);
      }
    }
  });
}

function handleRenderedClick(pane, e) {
  const ext = e.target.closest('a[href]');
  if (ext) {
    e.preventDefault();
    const href = ext.getAttribute('href');
    if (/^https?:\/\//i.test(href)) window.api.openExternal(href);
    return;
  }
  const link = e.target.closest('a.wikilink');
  if (link) {
    e.preventDefault();
    const target = link.dataset.target;
    const existing = noteByName(target);
    if (existing) {
      openNoteInPane(pane, existing.path);
    } else {
      window.api.createNote('', target).then(async (rel) => {
        await refreshAll();
        openNoteInPane(pane, rel);
      });
    }
    return;
  }
  const tag = e.target.closest('.tag');
  if (tag) {
    searchEl.value = '#' + tag.dataset.tag;
    runSearch();
  }
}

/* ---------- rename / create ---------- */

async function commitRename(pane, inputEl) {
  const note = noteByPath(pane.path);
  if (!note) return;
  const newName = inputEl.value.trim();
  if (!newName || newName === note.name) {
    inputEl.value = note.name;
    return;
  }
  try {
    const oldPath = note.path;
    const newPath = await window.api.renameNote(oldPath, newName);
    for (const p of panes) {
      if (p.path === oldPath) p.path = newPath;
      p.history = p.history.map((h) => (h === oldPath ? newPath : h));
    }
    remapPinned(oldPath, newPath);
    await refreshAll();
    openNoteInPane(pane, newPath);
  } catch (err) {
    alert(err.message.replace(/^.*Error: /, ''));
    inputEl.value = note.name;
  }
}

async function createNewNote(name) {
  if (!name) {
    name = await askName('New note', 'Untitled', 'Create');
    if (!name) return;
  }
  const rel = await window.api.createNote(selectedFolder, name);
  await refreshAll();
  const pane = focusedPane || panes[0];
  openNoteInPane(pane, rel);
}

async function renameNoteAt(path, newName) {
  try {
    const newPath = await window.api.renameNote(path, newName);
    for (const p of panes) {
      if (p.path === path) p.path = newPath;
      p.history = p.history.map((h) => (h === path ? newPath : h));
    }
    remapPinned(path, newPath);
    const orderArr = noteOrder[dirnameRel(path)];
    if (orderArr) {
      const oldName = path.split('/').pop().replace(/\.md$/i, '');
      const i = orderArr.indexOf(oldName);
      if (i !== -1) {
        orderArr[i] = newName;
        saveNoteOrder();
      }
    }
    await refreshAll();
  } catch (err) {
    alert(err.message.replace(/^.*Error: /, ''));
  }
}

async function renameFolderAt(path, newName) {
  try {
    const newRel = await window.api.renameFolder(path, newName);
    for (const p of panes) {
      if (p.path && (p.path === path || p.path.startsWith(path + '/'))) {
        p.path = newRel + p.path.slice(path.length);
      }
    }
    if (selectedFolder === path || selectedFolder.startsWith(path + '/')) {
      selectedFolder = newRel + selectedFolder.slice(path.length);
    }
    for (const k of Object.keys(noteOrder)) {
      if (k === path || k.startsWith(path + '/')) {
        noteOrder[newRel + k.slice(path.length)] = noteOrder[k];
        delete noteOrder[k];
      }
    }
    saveNoteOrder();
    await refreshAll();
  } catch (err) {
    alert(err.message.replace(/^.*Error: /, ''));
  }
}

async function deleteFolderAt(item) {
  if (!(await askConfirm(`Move "${item.name}" and everything inside it to the trash?`))) return;
  try {
    await window.api.deleteFolder(item.path);
    const inside = (p) => p === item.path || p.startsWith(item.path + '/');
    pinned = pinned.filter((p) => !inside(p));
    savePinned();
    for (const p of panes) {
      if (p.path && inside(p.path)) p.path = null;
    }
    for (const c of [...collapsed]) {
      if (inside(c)) collapsed.delete(c);
    }
    for (const k of Object.keys(noteOrder)) {
      if (inside(k)) delete noteOrder[k];
    }
    saveNoteOrder();
    if (selectedFolder && inside(selectedFolder)) selectedFolder = '';
    await refreshAll();
  } catch (err) {
    alert(err.message.replace(/^.*Error: /, ''));
  }
}

/* ---------- hide tags / hide backlinks ---------- */

let tagsHidden = localStorage.getItem('plainnote.hideTags') === '1';
let backlinksHidden = localStorage.getItem('plainnote.hideBacklinks') === '1';

function applyHiddenSections() {
  document.body.classList.toggle('hide-tags', tagsHidden);
  document.body.classList.toggle('hide-backlinks', backlinksHidden);
}
function toggleTagsHidden() {
  tagsHidden = !tagsHidden;
  localStorage.setItem('plainnote.hideTags', tagsHidden ? '1' : '0');
  applyHiddenSections();
}
function toggleBacklinksHidden() {
  backlinksHidden = !backlinksHidden;
  localStorage.setItem('plainnote.hideBacklinks', backlinksHidden ? '1' : '0');
  applyHiddenSections();
}
applyHiddenSections();

/* ---------- line numbers ---------- */

let lineNumbersOn = localStorage.getItem('plainnote.lineNumbers') === '1';
function applyLineNumbers() {
  document.body.classList.toggle('line-numbers', lineNumbersOn);
}
function toggleLineNumbers() {
  lineNumbersOn = !lineNumbersOn;
  localStorage.setItem('plainnote.lineNumbers', lineNumbersOn ? '1' : '0');
  applyLineNumbers();
  for (const p of panes) {
    if (p.mode === 'live') renderPane(p);
  }
}

/* ---------- theme ---------- */

let darkTheme = localStorage.getItem('plainnote.theme') === 'dark';
function applyTheme() {
  document.body.classList.toggle('theme-dark', darkTheme);
  const b = $('#btn-theme');
  b.innerHTML = darkTheme ? SUN_ICON : MOON_ICON;
  b.title = darkTheme ? 'Switch to light theme' : 'Switch to dark theme';
}
function toggleTheme() {
  darkTheme = !darkTheme;
  localStorage.setItem('plainnote.theme', darkTheme ? 'dark' : 'light');
  applyTheme();
}

/* ---------- inline title ---------- */

let inlineTitleOn = localStorage.getItem('plainnote.inlineTitle') === '1';
function applyInlineTitle() {
  document.body.classList.toggle('inline-title', inlineTitleOn);
}
function toggleInlineTitle() {
  inlineTitleOn = !inlineTitleOn;
  localStorage.setItem('plainnote.inlineTitle', inlineTitleOn ? '1' : '0');
  applyInlineTitle();
}

/* ---------- popup menu (settings dropdown + context menus) ---------- */

const menuEl = document.createElement('div');
menuEl.id = 'popmenu';
document.body.appendChild(menuEl);

const subMenuEl = document.createElement('div');
subMenuEl.id = 'popmenu-sub';
document.body.appendChild(subMenuEl);

function hideSubMenu() {
  subMenuEl.style.display = 'none';
}

function hideMenu() {
  menuEl.style.display = 'none';
  hideSubMenu();
}

function showSubMenu(row, items) {
  subMenuEl.innerHTML = '';
  for (const item of items) {
    const r = document.createElement('div');
    r.className = 'menu-item' + (item.danger ? ' danger' : '');
    r.innerHTML = `<span class="check">${item.checked ? '✓' : ''}</span><span>${escapeHtml(item.label)}</span>`;
    r.addEventListener('click', () => {
      hideMenu();
      item.action();
    });
    subMenuEl.appendChild(r);
  }
  subMenuEl.style.display = 'block';
  const rect = row.getBoundingClientRect();
  const w = subMenuEl.offsetWidth;
  const h = subMenuEl.offsetHeight;
  let x = rect.right + 2;
  if (x + w > window.innerWidth - 8) x = rect.left - w - 2;
  const y = Math.max(8, Math.min(rect.top - 5, window.innerHeight - h - 8));
  subMenuEl.style.left = x + 'px';
  subMenuEl.style.top = y + 'px';
}

function showMenu(x, y, items, anchor) {
  hideSubMenu();
  menuEl.innerHTML = '';
  for (const item of items) {
    const row = document.createElement('div');
    row.className = 'menu-item' + (item.danger ? ' danger' : '');
    if (item.submenu) {
      row.innerHTML = `<span class="check"></span><span>${escapeHtml(item.label)}</span><span class="sub-arrow"><svg width="11" height="11" viewBox="0 0 24 24"><path d="M9 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></span>`;
      row.addEventListener('mouseenter', () => showSubMenu(row, item.submenu));
      row.addEventListener('click', () => showSubMenu(row, item.submenu));
      menuEl.appendChild(row);
      continue;
    }
    row.innerHTML = `<span class="check">${item.checked ? '✓' : ''}</span><span>${escapeHtml(item.label)}</span>`;
    row.addEventListener('mouseenter', hideSubMenu);
    row.addEventListener('click', () => {
      hideMenu();
      item.action();
    });
    menuEl.appendChild(row);
  }
  menuEl.style.display = 'block';
  const w = menuEl.offsetWidth;
  const h = menuEl.offsetHeight;
  if (anchor) {
    x = anchor.left;
    if (x + w > window.innerWidth - 8) x = anchor.right - w;
    y = anchor.bottom + 2;
    if (y + h > window.innerHeight - 8) y = anchor.top - h - 2;
  }
  menuEl.style.left = Math.max(8, Math.min(x, window.innerWidth - w - 8)) + 'px';
  menuEl.style.top = Math.max(8, Math.min(y, window.innerHeight - h - 8)) + 'px';
}

document.addEventListener('mousedown', (e) => {
  if (!menuEl.contains(e.target) && !subMenuEl.contains(e.target)) hideMenu();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    hideMenu();
    const so = document.getElementById('stats-overlay');
    if (so) so.hidden = true;
  }
});

// Capture-phase so a selection edit runs before the app sees the key. A textarea's
// own selection isn't in window.getSelection(), so a non-collapsed doc selection means
// rendered lines are selected — handle it even while a line editor is focused.
document.addEventListener('keydown', (e) => {
  const pane = focusedPane;
  if (!pane || pane.mode !== 'live') return;
  const ae = document.activeElement;
  if (ae && ae.tagName === 'INPUT') return; // search / find / rename fields
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed) return;
  liveSelectionEdit(pane, e);
}, true);

document.addEventListener('copy', (e) => {
  const pane = focusedPane;
  if (pane && pane.mode === 'live') liveClipboard(pane, e, false);
});
document.addEventListener('cut', (e) => {
  const pane = focusedPane;
  if (pane && pane.mode === 'live') liveClipboard(pane, e, true);
});

/* ---------- sidebar tree ---------- */

async function moveNoteTo(srcPath, folderPath) {
  const newRel = await window.api.moveNote(srcPath, folderPath);
  for (const p of panes) {
    if (p.path === srcPath) p.path = newRel;
    p.history = p.history.map((h) => (h === srcPath ? newRel : h));
  }
  remapPinned(srcPath, newRel);
  collapsed.delete(folderPath);
  await refreshAll();
}

function makeFolderDropTarget(el, folderPath) {
  el.addEventListener('dragover', (e) => {
    if (!e.dataTransfer.types.includes(DRAG_TYPE)) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';
    el.classList.add('drop-target');
  });
  el.addEventListener('dragleave', () => el.classList.remove('drop-target'));
  el.addEventListener('drop', async (e) => {
    if (!e.dataTransfer.types.includes(DRAG_TYPE)) return;
    e.preventDefault();
    e.stopPropagation();
    el.classList.remove('drop-target');
    const src = e.dataTransfer.getData(DRAG_TYPE);
    if (src) await moveNoteTo(src, folderPath);
  });
}

/* ---------- pinned notes ---------- */

let pinned = [];
try {
  pinned = JSON.parse(localStorage.getItem('plainnote.pinned') || '[]');
} catch (_) {
  pinned = [];
}

function savePinned() {
  localStorage.setItem('plainnote.pinned', JSON.stringify(pinned));
}

function togglePinned(path) {
  if (pinned.includes(path)) pinned = pinned.filter((p) => p !== path);
  else pinned.push(path);
  savePinned();
  renderTree();
}

function remapPinned(oldPath, newPath) {
  pinned = pinned.map((p) => (p === oldPath ? newPath : p));
  savePinned();
}

/* ---------- manual note order ---------- */

let noteOrder = {};
try {
  noteOrder = JSON.parse(localStorage.getItem('plainnote.order') || '{}');
} catch (_) {
  noteOrder = {};
}

function saveNoteOrder() {
  localStorage.setItem('plainnote.order', JSON.stringify(noteOrder));
}

function dirnameRel(p) {
  const i = p.lastIndexOf('/');
  return i === -1 ? '' : p.slice(0, i);
}

function applyNoteOrder(items, parentPath) {
  const order = noteOrder[parentPath];
  if (!order || !order.length) return items;
  return [...items].sort((a, b) => {
    if (a.type !== b.type) return a.type === 'folder' ? -1 : 1;
    if (a.type !== 'note') return 0;
    const ia = order.indexOf(a.name);
    const ib = order.indexOf(b.name);
    if (ia === -1 && ib === -1) return 0;
    return (ia === -1 ? Infinity : ia) - (ib === -1 ? Infinity : ib);
  });
}

async function reorderNote(srcPath, target, below, rowEl) {
  const targetFolder = dirnameRel(target.path);
  const srcFolder = dirnameRel(srcPath);
  const srcName = srcPath.split('/').pop().replace(/\.md$/i, '');
  const levelNames = [...rowEl.parentElement.children]
    .filter((el) => el.classList && el.classList.contains('note-row') && !el.classList.contains('pinned-row'))
    .map((el) => el.dataset.path.split('/').pop().replace(/\.md$/i, ''));
  const list = levelNames.filter((n) => n !== srcName);
  const ti = list.indexOf(target.name);
  list.splice(below ? ti + 1 : ti, 0, srcName);
  noteOrder[targetFolder] = list;
  saveNoteOrder();
  if (srcFolder !== targetFolder) await moveNoteTo(srcPath, targetFolder);
  else await refreshAll();
}

/* ---------- note context menu + export ---------- */

async function exportNote(item, format) {
  const note = noteByPath(item.path);
  if (!note) return;
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${escapeHtml(note.name)}</title><style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; color: #161616; max-width: 700px; margin: 48px auto; padding: 0 24px; line-height: 1.65; font-size: 15px; }
    h1, h2, h3, h4 { line-height: 1.3; margin: 1.4em 0 0.5em; }
    code { font-family: ui-monospace, "SF Mono", Menlo, monospace; font-size: 0.85em; background: #f5f5f2; padding: 2px 5px; border-radius: 4px; }
    pre { background: #f5f5f2; padding: 14px 16px; border-radius: 8px; overflow-x: auto; }
    pre code { background: none; padding: 0; }
    blockquote { margin: 0.8em 0; padding: 2px 16px; border-left: 3px solid #d4d4d0; color: #4a4a4a; }
    a.wikilink { color: inherit; border-bottom: 1.5px solid #161616; text-decoration: none; font-weight: 500; }
    .tag { font-size: 0.82em; background: #e9e9e5; color: #4a4a4a; padding: 1px 8px; border-radius: 99px; }
    table { border-collapse: collapse; } th, td { border: 1px solid #e6e6e2; padding: 6px 12px; text-align: left; }
    hr { border: none; border-top: 1px solid #e6e6e2; margin: 1.5em 0; }
  </style></head><body>${inlineTitleOn ? `<h1>${escapeHtml(note.name)}</h1>` : ''}${renderMarkdown(note.content)}</body></html>`;
  await window.api.exportNote(note.name, html, format);
}

function noteContextMenu(e, item) {
  e.preventDefault();
  showMenu(e.clientX, e.clientY, [
    { label: pinned.includes(item.path) ? 'Unpin' : 'Pin', action: () => togglePinned(item.path) },
    { label: 'Rename…', action: async () => {
      const name = await askName('Rename note', item.name, 'Rename');
      if (name && name !== item.name) await renameNoteAt(item.path, name);
    } },
    { label: 'Export', submenu: [
      { label: 'Export as PDF…', action: () => exportNote(item, 'pdf') },
      { label: 'Export as HTML…', action: () => exportNote(item, 'html') },
    ] },
    { label: 'Move to trash', danger: true, action: async () => {
      if (!(await askConfirm(`Move "${item.name}" to the trash?`))) return;
      try {
        await window.api.deleteNote(item.path);
        pinned = pinned.filter((p) => p !== item.path);
        savePinned();
        for (const p of panes) {
          if (p.path === item.path) p.path = null;
        }
        await refreshAll();
      } catch (err) {
        alert(err.message.replace(/^.*Error: /, ''));
      }
    } },
  ]);
}

function renderTree() {
  treeEl.innerHTML = '';
  const pinnedNotes = pinned.map((p) => noteByPath(p)).filter(Boolean);
  if (pinnedNotes.length) {
    const label = document.createElement('div');
    label.className = 'section-label pinned-label';
    label.textContent = 'Pinned';
    treeEl.appendChild(label);
    for (const note of pinnedNotes) {
      const row = document.createElement('div');
      row.className = 'tree-row note-row pinned-row';
      row.dataset.path = note.path;
      row.innerHTML = `<span class="chevron"></span><span class="row-name">${escapeHtml(note.name)}</span>`;
      row.addEventListener('click', () => openNote(note.path));
      row.addEventListener('contextmenu', (e) => noteContextMenu(e, { path: note.path, name: note.name }));
      treeEl.appendChild(row);
    }
    const sep = document.createElement('div');
    sep.className = 'pinned-sep';
    treeEl.appendChild(sep);
  }
  treeEl.appendChild(buildTreeLevel(tree));
  updateTreeHighlight();
}

function buildTreeLevel(items, parentPath = '') {
  const frag = document.createDocumentFragment();
  for (const item of applyNoteOrder(items, parentPath)) {
    if (item.type === 'folder') {
      const row = document.createElement('div');
      row.className = 'tree-row folder-row' + (collapsed.has(item.path) ? ' collapsed' : '');
      row.innerHTML = `<span class="chevron"><svg width="14" height="14" viewBox="0 0 24 24"><path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></span><span class="row-name">${escapeHtml(item.name)}</span>` +
        `<button class="row-delete" title="Move to trash"><svg width="14" height="14" viewBox="0 0 24 24"><path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6M10 11v6M14 11v6" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg></button>`;
      makeFolderDropTarget(row, item.path);
      const childWrap = document.createElement('div');
      childWrap.className = 'tree-children' + (collapsed.has(item.path) ? ' hidden' : '');
      childWrap.appendChild(buildTreeLevel(item.children, item.path));
      row.addEventListener('click', (e) => {
        if (e.target.closest('.row-delete')) return;
        selectedFolder = item.path;
        if (collapsed.has(item.path)) collapsed.delete(item.path);
        else collapsed.add(item.path);
        row.classList.toggle('collapsed');
        childWrap.classList.toggle('hidden');
      });
      row.querySelector('.row-delete').addEventListener('click', () => deleteFolderAt(item));
      row.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        showMenu(e.clientX, e.clientY, [
          { label: 'Rename folder…', action: async () => {
            const name = await askName('Rename folder', item.name, 'Rename');
            if (name && name !== item.name) await renameFolderAt(item.path, name);
          } },
          { label: 'New note here…', action: () => {
            selectedFolder = item.path;
            collapsed.delete(item.path);
            createNewNote();
          } },
          { label: 'Move to trash', danger: true, action: () => deleteFolderAt(item) },
        ]);
      });
      frag.appendChild(row);
      frag.appendChild(childWrap);
    } else {
      const row = document.createElement('div');
      row.className = 'tree-row note-row';
      row.dataset.path = item.path;
      row.draggable = true;
      row.addEventListener('dragstart', (e) => {
        // Don't start a row drag when grabbing the trash button, or the drag
        // eats its click and the delete never fires.
        if (e.target.closest('.row-delete')) { e.preventDefault(); return; }
        e.dataTransfer.setData(DRAG_TYPE, item.path);
        e.dataTransfer.effectAllowed = 'move';
        row.classList.add('dragging');
      });
      row.addEventListener('dragend', () => row.classList.remove('dragging'));
      row.addEventListener('dragover', (e) => {
        if (!e.dataTransfer.types.includes(DRAG_TYPE)) return;
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = 'move';
        const below = e.offsetY > row.offsetHeight / 2;
        row.classList.toggle('drop-below', below);
        row.classList.toggle('drop-above', !below);
      });
      row.addEventListener('dragleave', () => row.classList.remove('drop-above', 'drop-below'));
      row.addEventListener('drop', async (e) => {
        if (!e.dataTransfer.types.includes(DRAG_TYPE)) return;
        e.preventDefault();
        e.stopPropagation();
        const below = row.classList.contains('drop-below');
        row.classList.remove('drop-above', 'drop-below');
        const src = e.dataTransfer.getData(DRAG_TYPE);
        if (src && src !== item.path) await reorderNote(src, item, below, row);
      });
      row.innerHTML = `<span class="chevron"></span><span class="row-name">${escapeHtml(item.name)}</span>` +
        `<button class="row-delete" title="Move to trash"><svg width="14" height="14" viewBox="0 0 24 24"><path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6M10 11v6M14 11v6" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg></button>`;
      row.addEventListener('click', (e) => {
        if (e.target.closest('.row-delete')) return;
        openNote(item.path);
      });
      row.addEventListener('contextmenu', (e) => noteContextMenu(e, { path: item.path, name: item.name }));
      row.querySelector('.row-delete').addEventListener('click', async () => {
        if (!(await askConfirm(`Move "${item.name}" to the trash?`))) return;
        try {
          await window.api.deleteNote(item.path);
          pinned = pinned.filter((p) => p !== item.path);
          savePinned();
          for (const p of panes) {
            if (p.path === item.path) p.path = null;
          }
          await refreshAll();
        } catch (err) {
          alert(err.message.replace(/^.*Error: /, ''));
        }
      });
      frag.appendChild(row);
    }
  }
  return frag;
}

/* ---------- tags ---------- */

function collectTags() {
  const counts = new Map();
  for (const n of notes) {
    let m;
    TAG_RE.lastIndex = 0;
    while ((m = TAG_RE.exec(n.content)) !== null) {
      counts.set(m[2], (counts.get(m[2]) || 0) + 1);
    }
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

let tagsExpanded = false;

function makeTagPill(tag, count) {
  const pill = document.createElement('span');
  pill.className = 'tag-pill';
  pill.innerHTML = `#${escapeHtml(tag)}<span class="tag-count">${count}</span>`;
  pill.addEventListener('click', () => {
    searchEl.value = '#' + tag;
    runSearch();
  });
  return pill;
}

function makeMorePill(text) {
  const more = document.createElement('span');
  more.className = 'tag-pill tag-more';
  more.textContent = text;
  more.addEventListener('click', () => {
    tagsExpanded = !tagsExpanded;
    renderTags();
  });
  return more;
}

function renderTags() {
  const tagsEl = $('#tags');
  tagsEl.innerHTML = '';
  const tags = collectTags();
  $('#tags-section').style.display = tags.length ? '' : 'none';
  if (!tags.length) return;

  if (tagsExpanded) {
    for (const [tag, count] of tags) tagsEl.appendChild(makeTagPill(tag, count));
    tagsEl.appendChild(makeMorePill('show less'));
    return;
  }

  // Fit as many pills as the panel height allows; the rest collapse into "+N more".
  const fits = () => tagsEl.scrollHeight <= tagsEl.clientHeight + 2;
  const pills = [];
  for (const [tag, count] of tags) {
    const pill = makeTagPill(tag, count);
    tagsEl.appendChild(pill);
    pills.push(pill);
    if (!fits()) break;
  }
  while (pills.length > 1 && !fits()) tagsEl.removeChild(pills.pop());
  if (pills.length < tags.length) {
    const more = makeMorePill(`+${tags.length - pills.length} more`);
    tagsEl.appendChild(more);
    while (pills.length > 1 && !fits()) {
      tagsEl.removeChild(pills.pop());
      more.textContent = `+${tags.length - pills.length} more`;
    }
  }
}

/* ---------- search ---------- */

function runSearch() {
  const q = searchEl.value.trim();
  if (!q) {
    searchResultsEl.hidden = true;
    treeEl.hidden = false;
    return;
  }
  treeEl.hidden = true;
  searchResultsEl.hidden = false;
  searchResultsEl.innerHTML = '';

  let hits;
  if (q.startsWith('#') && q.length > 1) {
    const tag = q.slice(1).toLowerCase();
    hits = notes
      .filter((n) => {
        TAG_RE.lastIndex = 0;
        let m;
        while ((m = TAG_RE.exec(n.content)) !== null) {
          if (m[2].toLowerCase() === tag || m[2].toLowerCase().startsWith(tag + '/')) return true;
        }
        return false;
      })
      .map((n) => ({ note: n, snippet: firstTagLine(n.content, tag) }));
  } else {
    const lower = q.toLowerCase();
    hits = notes
      .filter((n) => n.name.toLowerCase().includes(lower) || n.content.toLowerCase().includes(lower))
      .map((n) => {
        const idx = n.content.toLowerCase().indexOf(lower);
        let snippet = '';
        if (idx >= 0) {
          const start = Math.max(0, idx - 30);
          snippet = (start > 0 ? '…' : '') + n.content.slice(start, idx + 60).replace(/\n/g, ' ');
        }
        return { note: n, snippet };
      });
  }

  if (hits.length === 0) {
    searchResultsEl.innerHTML = '<div class="search-empty">No matches</div>';
    return;
  }
  for (const { note, snippet } of hits) {
    const el = document.createElement('div');
    el.className = 'search-hit';
    el.innerHTML = `<div class="hit-name">${escapeHtml(note.name)}</div>` +
      (snippet ? `<div class="hit-snippet">${escapeHtml(snippet)}</div>` : '');
    el.addEventListener('click', () => openNote(note.path));
    searchResultsEl.appendChild(el);
  }
}

function firstTagLine(content, tag) {
  const line = content.split('\n').find((l) => l.toLowerCase().includes('#' + tag));
  return line ? line.trim() : '';
}

/* ---------- backlinks ---------- */

function renderBacklinks(pane) {
  const listEl = pane.backlinksEl;
  listEl.innerHTML = '';
  const note = noteByPath(pane.path);
  if (!note) return;
  const re = wikilinkRegex(note.name);
  const linking = notes.filter((n) => n.path !== note.path && re.test(n.content));
  if (linking.length === 0) {
    listEl.innerHTML = '<div class="backlinks-empty">No notes link here yet. Link to this note with [[' + escapeHtml(note.name) + ']].</div>';
    return;
  }
  for (const n of linking) {
    const line = n.content.split('\n').find((l) => re.test(l)) || '';
    const el = document.createElement('span');
    el.className = 'backlink-pill';
    el.textContent = n.name;
    el.title = line.trim();
    el.addEventListener('click', () => openNoteInPane(pane, n.path));
    listEl.appendChild(el);
  }
}

/* ---------- refresh ---------- */

async function refreshAll() {
  [tree, notes] = await Promise.all([window.api.getTree(), window.api.getAllNotes()]);
  renderTree();
  renderTags();
  for (const pane of panes) {
    if (pane.path && !noteByPath(pane.path)) pane.path = null;
    const note = noteByPath(pane.path);
    if (note) pane.inlineTitleEl.value = note.name;
    if (pane.mode === 'live' && pane.active === null) enterLivePane(pane);
    else if (pane.mode === 'read' || !note) renderPane(pane);
    renderBacklinks(pane);
  }
  if (!searchResultsEl.hidden) runSearch();
}

/* ---------- modal ---------- */

function askName(label, def = '', okText = 'Create') {
  return new Promise((resolve) => {
    const overlay = $('#modal-overlay');
    const input = $('#modal-input');
    $('#modal-label').textContent = label;
    $('#modal-ok').textContent = okText;
    input.value = def;
    overlay.hidden = false;
    input.focus();
    input.select();

    function done(value) {
      overlay.hidden = true;
      input.removeEventListener('keydown', onKey);
      $('#modal-ok').onclick = null;
      $('#modal-cancel').onclick = null;
      overlay.onclick = null;
      resolve(value);
    }
    function onKey(e) {
      if (e.key === 'Enter') done(input.value.trim() || null);
      if (e.key === 'Escape') done(null);
    }
    input.addEventListener('keydown', onKey);
    $('#modal-ok').onclick = () => done(input.value.trim() || null);
    $('#modal-cancel').onclick = () => done(null);
    overlay.onclick = (e) => { if (e.target === overlay) done(null); };
  });
}

// In-app confirm. Native confirm() is suppressed by Chromium when triggered from
// a drag-capable element (the sidebar rows), so deletes silently did nothing.
function askConfirm(message, okText = 'Delete') {
  return new Promise((resolve) => {
    const overlay = $('#modal-overlay');
    const input = $('#modal-input');
    $('#modal-label').textContent = message;
    $('#modal-ok').textContent = okText;
    input.hidden = true;
    overlay.hidden = false;
    $('#modal-ok').focus();

    function done(value) {
      overlay.hidden = true;
      input.hidden = false;
      document.removeEventListener('keydown', onKey, true);
      $('#modal-ok').onclick = null;
      $('#modal-cancel').onclick = null;
      overlay.onclick = null;
      resolve(value);
    }
    function onKey(e) {
      if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); done(true); }
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); done(false); }
    }
    document.addEventListener('keydown', onKey, true);
    $('#modal-ok').onclick = () => done(true);
    $('#modal-cancel').onclick = () => done(false);
    overlay.onclick = (e) => { if (e.target === overlay) done(false); };
  });
}

/* ---------- sidebar events ---------- */

$('#btn-new-note').addEventListener('click', () => createNewNote());

async function createNewFolder() {
  const name = await askName('New folder name');
  if (!name) return;
  await window.api.createFolder(selectedFolder, name);
  await refreshAll();
}

$('#btn-new-folder').addEventListener('click', createNewFolder);

// Right-click on empty sidebar space: create at the vault root
treeEl.addEventListener('contextmenu', (e) => {
  if (e.target.closest('.tree-row')) return;
  e.preventDefault();
  selectedFolder = '';
  showMenu(e.clientX, e.clientY, [
    { label: 'New note…', action: () => createNewNote() },
    { label: 'New folder…', action: createNewFolder },
  ]);
});

$('#btn-vault').addEventListener('click', async () => {
  const newVault = await window.api.chooseVault();
  if (!newVault) return;
  for (const p of panes) p.path = null;
  await updateVaultLabel();
  await refreshAll();
});

$('#btn-reveal').addEventListener('click', () => window.api.revealVault());

$('#btn-theme').addEventListener('click', toggleTheme);

/* ---------- sidebar: collapse + drag resize ---------- */

const sidebarEl = $('#sidebar');
let sidebarW = parseInt(localStorage.getItem('plainnote.sidebarW') || '260', 10) || 260;
let sidebarHidden = localStorage.getItem('plainnote.sidebarHidden') === '1';

function applySidebar() {
  sidebarEl.style.width = sidebarW + 'px';
  sidebarEl.style.minWidth = sidebarW + 'px';
  document.body.classList.toggle('sidebar-hidden', sidebarHidden);
}

function toggleSidebar() {
  sidebarHidden = !sidebarHidden;
  localStorage.setItem('plainnote.sidebarHidden', sidebarHidden ? '1' : '0');
  applySidebar();
}

$('#btn-collapse').addEventListener('click', toggleSidebar);
$('#btn-expand').addEventListener('click', toggleSidebar);

let sidebarDrag = null;
$('#sidebar-resize').addEventListener('mousedown', (e) => {
  sidebarDrag = { x: e.clientX, w: sidebarEl.offsetWidth };
  e.preventDefault();
});
document.addEventListener('mousemove', (e) => {
  if (!sidebarDrag) return;
  const w = sidebarDrag.w + (e.clientX - sidebarDrag.x);
  sidebarW = Math.max(180, Math.min(Math.round(window.innerWidth * 0.5), w));
  applySidebar();
});
document.addEventListener('mouseup', () => {
  if (sidebarDrag) {
    localStorage.setItem('plainnote.sidebarW', String(sidebarW));
    sidebarDrag = null;
  }
});
applySidebar();

$('#btn-settings').innerHTML = GEAR_ICON;
let settingsMenuWasOpen = false;
$('#btn-settings').addEventListener('mousedown', () => {
  settingsMenuWasOpen = menuEl.style.display === 'block';
});
$('#btn-settings').addEventListener('click', (e) => {
  e.stopPropagation();
  if (settingsMenuWasOpen) {
    settingsMenuWasOpen = false;
    hideMenu();
    return;
  }
  const r = e.currentTarget.getBoundingClientRect();
  showMenu(0, 0, [
    { label: 'Show note title', checked: inlineTitleOn, action: toggleInlineTitle },
    { label: 'Show line numbers', checked: lineNumbersOn, action: toggleLineNumbers },
    { label: 'Show tags', checked: !tagsHidden, action: toggleTagsHidden },
    { label: 'Show backlinks', checked: !backlinksHidden, action: toggleBacklinksHidden },
    { label: 'Stats…', action: showStats },
    { label: 'Check for updates…', action: checkForUpdatesManually },
    { label: 'Reset to defaults', danger: true, action: resetDefaults },
  ], r);
});

async function resetDefaults() {
  if (!confirm('Reset all settings and layout to their defaults?')) return;
  for (const key of Object.keys(localStorage)) {
    if (key.startsWith('plainnote.')) localStorage.removeItem(key);
  }
  inlineTitleOn = false;
  lineNumbersOn = false;
  tagsHidden = false;
  backlinksHidden = false;
  darkTheme = false;
  tagsHeight = TAGS_DEFAULT_H;
  sidebarW = 260;
  sidebarHidden = false;
  splitRatio = 0.5;
  pinned = [];
  noteOrder = {};
  window.api.resetZoom();
  applyInlineTitle();
  applyLineNumbers();
  applyHiddenSections();
  applyTheme();
  applyTagsLayout();
  applySidebar();
  applySplitRatio();
  renderTags();
  for (const p of panes) {
    if (p.mode === 'live') renderPane(p);
  }
  await refreshAll();
}

/* ---------- stats ---------- */

const statsOverlay = document.createElement('div');
statsOverlay.id = 'stats-overlay';
statsOverlay.hidden = true;
statsOverlay.innerHTML = '<div id="stats-card"><div class="section-label">Stats</div><div id="stats-rows"></div><button id="stats-close">Done</button></div>';
document.body.appendChild(statsOverlay);
statsOverlay.addEventListener('mousedown', (e) => {
  if (e.target === statsOverlay) statsOverlay.hidden = true;
});
statsOverlay.querySelector('#stats-close').addEventListener('click', () => {
  statsOverlay.hidden = true;
});

function countFolders(items) {
  let n = 0;
  for (const item of items) {
    if (item.type === 'folder') n += 1 + countFolders(item.children);
  }
  return n;
}

function textCounts(content) {
  return {
    words: (content.trim().match(/\S+/g) || []).length,
    chars: content.length,
    lines: content.split('\n').length,
  };
}

function showStats() {
  let words = 0;
  let chars = 0;
  let lines = 0;
  let links = 0;
  for (const n of notes) {
    const c = textCounts(n.content);
    words += c.words;
    chars += c.chars;
    lines += c.lines;
    links += (n.content.match(/\[\[[^\]]+\]\]/g) || []).length;
  }
  const fmt = (v) => v.toLocaleString();
  const rows = [
    ['Notes', notes.length],
    ['Folders', countFolders(tree)],
    ['Words', words],
    ['Characters', chars],
    ['Lines', lines],
    ['Unique tags', collectTags().length],
    ['Wikilinks', links],
  ];
  let html = rows.map(([l, v]) => `<div class="stat-row"><span>${l}</span><span class="stat-val">${fmt(v)}</span></div>`).join('');

  const current = noteByPath((focusedPane || panes[0]).path);
  if (current) {
    const c = textCounts(current.content);
    html += `<div class="section-label stat-sub">${escapeHtml(current.name)}</div>` +
      `<div class="stat-row"><span>Words</span><span class="stat-val">${fmt(c.words)}</span></div>` +
      `<div class="stat-row"><span>Characters</span><span class="stat-val">${fmt(c.chars)}</span></div>` +
      `<div class="stat-row"><span>Lines</span><span class="stat-val">${fmt(c.lines)}</span></div>`;
  }
  statsOverlay.querySelector('#stats-rows').innerHTML = html;
  statsOverlay.hidden = false;
}

const searchClearEl = $('#search-clear');
searchEl.addEventListener('input', () => {
  searchClearEl.hidden = !searchEl.value;
});
searchClearEl.addEventListener('click', () => {
  searchEl.value = '';
  searchClearEl.hidden = true;
  searchEl.focus();
  runSearch();
});

searchEl.addEventListener('input', runSearch);
searchEl.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    searchEl.value = '';
    runSearch();
    searchEl.blur();
  }
});

/* ---------- tags section: collapse + drag resize ---------- */

const tagsSection = $('#tags-section');
const TAGS_DEFAULT_H = 110;
let tagsHeight = parseInt(localStorage.getItem('plainnote.tagsH') || '0', 10) || TAGS_DEFAULT_H;

function applyTagsLayout() {
  tagsSection.style.height = tagsHeight ? tagsHeight + 'px' : '';
  tagsSection.style.maxHeight = tagsHeight ? 'none' : '';
}

let tagsDrag = null;
$('.tags-resize').addEventListener('mousedown', (e) => {
  tagsDrag = { y: e.clientY, h: tagsSection.offsetHeight };
  e.preventDefault();
});
document.addEventListener('mousemove', (e) => {
  if (!tagsDrag) return;
  const h = tagsDrag.h - (e.clientY - tagsDrag.y);
  tagsHeight = Math.max(60, Math.min(Math.round(window.innerHeight * 0.6), h));
  applyTagsLayout();
  renderTags();
});
document.addEventListener('mouseup', () => {
  if (tagsDrag) {
    localStorage.setItem('plainnote.tagsH', String(tagsHeight));
    tagsDrag = null;
  }
});
applyTagsLayout();

/* ---------- drag & drop: move to root, import files ---------- */

treeEl.addEventListener('dragover', (e) => {
  if (!e.dataTransfer.types.includes(DRAG_TYPE)) return;
  if (e.target.closest('.folder-row')) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  treeEl.classList.add('drop-root');
});
treeEl.addEventListener('dragleave', (e) => {
  if (!treeEl.contains(e.relatedTarget)) treeEl.classList.remove('drop-root');
});

// Native edit menu (cut/copy/paste) for text fields and selected text.
// Runs last: anything with its own context menu has already called preventDefault.
document.addEventListener('contextmenu', (e) => {
  if (e.defaultPrevented) return;
  const editable = e.target.closest('input, textarea, [contenteditable="true"]');
  const sel = window.getSelection();
  if (!editable && !sel.toString().length) return;
  e.preventDefault();
  // For a rendered live selection, copy the source markdown, not the mangled DOM text.
  let copyText = null;
  const pane = focusedPane;
  if (!editable && pane && pane.mode === 'live' && sel.rangeCount) {
    const range = sel.getRangeAt(0);
    if (pane.contentEl.contains(range.startContainer) && pane.contentEl.contains(range.endContainer)) {
      copyText = liveSelectionText(pane, range);
    }
  }
  window.api.showEditMenu(!!editable, copyText);
});

// A drag can end anywhere (Esc, drop outside a target) — always clear leftover highlights
document.addEventListener('dragend', () => {
  treeEl.classList.remove('drop-root');
  for (const el of document.querySelectorAll('.drop-target, .drop-above, .drop-below')) {
    el.classList.remove('drop-target', 'drop-above', 'drop-below');
  }
});
treeEl.addEventListener('drop', async (e) => {
  treeEl.classList.remove('drop-root');
  if (!e.dataTransfer.types.includes(DRAG_TYPE)) return;
  if (e.target.closest('.folder-row')) return;
  e.preventDefault();
  const src = e.dataTransfer.getData(DRAG_TYPE);
  if (src) await moveNoteTo(src, '');
});

document.addEventListener('dragover', (e) => {
  if (e.dataTransfer.types.includes('Files')) e.preventDefault();
});
document.addEventListener('drop', async (e) => {
  if (!e.dataTransfer.files.length || e.dataTransfer.types.includes(DRAG_TYPE)) return;
  e.preventDefault();
  let lastImported = null;
  let skipped = 0;
  for (const file of e.dataTransfer.files) {
    const abs = window.api.getPathForFile(file);
    if (/\.(md|markdown|txt)$/i.test(abs)) {
      lastImported = await window.api.importNote(abs);
    } else {
      skipped += 1;
    }
  }
  if (lastImported) {
    await refreshAll();
    openNote(lastImported);
  }
  if (skipped) alert(`Skipped ${skipped} file(s) — only .md and .txt can be imported.`);
});

/* ---------- keyboard ---------- */

document.addEventListener('keydown', (e) => {
  const mod = e.metaKey || e.ctrlKey;
  if (!mod) return;
  if (e.key === 'n') { e.preventDefault(); createNewNote(); }
  if (e.key === 'e') {
    e.preventDefault();
    const pane = focusedPane || panes[0];
    setPaneMode(pane, pane.mode === 'live' ? 'read' : 'live');
  }
  if (e.key === '\\') { e.preventDefault(); if (panes.length === 1) addSplitPane(); else closePane(panes[1]); }
  if (e.key === 'b') { e.preventDefault(); toggleSidebar(); }
  if (e.key === '[') { e.preventDefault(); paneGoBack(focusedPane || panes[0]); }
  if (e.key === ']') { e.preventDefault(); paneGoForward(focusedPane || panes[0]); }
  if (e.key === 'z' || e.key === 'y') {
    const ae = document.activeElement;
    // Let a line editor with un-committed typing use its own native undo.
    if (ae && ae.classList && ae.classList.contains('live-editor') &&
        ae.value !== ae._activatedValue) return;
    e.preventDefault();
    const pane = focusedPane || panes[0];
    const redo = e.key === 'y' || e.shiftKey; // Cmd+Y or Cmd+Shift+Z
    if (redo) redoPane(pane);
    else undoPane(pane);
  }
  if (e.key === 'f' && e.shiftKey) { e.preventDefault(); searchEl.focus(); }
  if (e.key === 'f' && !e.shiftKey) { e.preventDefault(); openFind(); }
});

/* ---------- init ---------- */

async function updateVaultLabel() {
  const vault = await window.api.getVault();
  $('#vault-name').textContent = vault.split('/').pop();
  $('#btn-vault').title = vault;
}

(async function init() {
  const paneA = createPane();
  panes.push(paneA);
  panesWrap.appendChild(paneA.el);
  updatePaneChrome();
  setFocusedPane(paneA);
  applyInlineTitle();
  applyTheme();
  applyLineNumbers();
  await updateVaultLabel();
  await refreshAll();
  const first = notes.find((n) => n.name === 'Welcome') || notes[0];
  if (first) openNote(first.path);
  else renderPane(paneA);
})();
