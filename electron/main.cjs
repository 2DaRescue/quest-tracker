const { app, BrowserWindow, Tray, Menu, ipcMain, screen, nativeImage, shell } = require('electron');
const path = require('node:path');
const store = require('./store.cjs');

const DEV = process.argv.includes('--dev');
const DEV_URL = 'http://localhost:4200';
const PRELOAD = path.join(__dirname, 'preload.cjs');
const BG = '#1d1f27';

// Tray popup timing (from the plan): open after ~300 ms hover, close ~700 ms after leaving.
const OPEN_DELAY_MS = 300;
const CLOSE_DELAY_MS = 700;
const POLL_MS = 80;

let tray = null;
let widget = null;
let popup = null;
let editor = null;
let quitting = false;

const pop = { pinned: false, editing: false, openTimer: null, poll: null, outsideSince: null };

// ---- helpers ---------------------------------------------------------------

function load(win, view) {
  if (DEV) win.loadURL(`${DEV_URL}/#${view}`);
  else win.loadFile(path.join(__dirname, '..', 'dist', 'quest-tracker', 'browser', 'index.html'), { hash: view });
}

const contains = (r, p, pad = 0) =>
  r.width > 0 && p.x >= r.x - pad && p.x < r.x + r.width + pad && p.y >= r.y - pad && p.y < r.y + r.height + pad;

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

// Draw the tray icon in code (gold disc + check mark) so no image asset is needed.
function makeIcon() {
  const draw = (size) => {
    const buf = Buffer.alloc(size * size * 4);
    const c = (size - 1) / 2;
    const r = size / 2 - 0.5;
    const seg = (px, py, ax, ay, bx, by) => {
      const dx = bx - ax, dy = by - ay;
      const t = clamp(((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy), 0, 1);
      return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
    };
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++) {
        const d = Math.hypot(x - c, y - c);
        const alpha = clamp(r - d + 0.5, 0, 1);
        if (!alpha) continue;
        const nx = x / size, ny = y / size;
        const check = Math.min(seg(nx, ny, 0.27, 0.52, 0.43, 0.68), seg(nx, ny, 0.43, 0.68, 0.74, 0.34));
        const dark = check < 0.075;
        const i = (y * size + x) * 4; // BGRA
        buf[i] = dark ? 0x27 : 0x3c;
        buf[i + 1] = dark ? 0x1f : 0xb4;
        buf[i + 2] = dark ? 0x1d : 0xf5;
        buf[i + 3] = Math.round(alpha * 255);
      }
    return buf;
  };
  const img = nativeImage.createFromBitmap(draw(16), { width: 16, height: 16 });
  img.addRepresentation({ scaleFactor: 2, width: 32, height: 32, buffer: draw(32) });
  return img;
}

function broadcast(channel, payload) {
  for (const win of BrowserWindow.getAllWindows()) if (!win.isDestroyed()) win.webContents.send(channel, payload);
}

// ---- desktop widget --------------------------------------------------------

function onScreen(b) {
  return b && screen.getAllDisplays().some((d) => contains(d.workArea, { x: b.x + 40, y: b.y + 10 }));
}

function createWidget() {
  const { settings } = store.get();
  const wa = screen.getPrimaryDisplay().workArea;
  const bounds = onScreen(settings.widgetBounds)
    ? settings.widgetBounds
    : { width: 300, height: 420, x: wa.x + wa.width - 324, y: wa.y + 24 };

  widget = new BrowserWindow({
    ...bounds,
    minWidth: 220,
    minHeight: 140,
    frame: false,
    skipTaskbar: true, // no taskbar clutter
    alwaysOnTop: false, // sits behind normal windows like a sticky note
    maximizable: false,
    fullscreenable: false,
    show: false,
    title: 'Quest Tracker',
    backgroundColor: BG,
    webPreferences: { preload: PRELOAD },
  });
  widget.setOpacity(settings.opacity);
  widget.once('ready-to-show', () => widget.showInactive());

  const saveBounds = debounce(() => {
    if (!widget.isDestroyed()) store.dispatch({ type: 'settings.update', patch: { widgetBounds: widget.getBounds() } });
  }, 400);
  widget.on('moved', saveBounds);
  widget.on('resized', saveBounds);
  widget.on('close', (e) => {
    if (!quitting) {
      e.preventDefault();
      widget.hide();
    }
  });
  load(widget, 'widget');
}

function showWidget() {
  widget.showInactive();
}

// ---- full editor -----------------------------------------------------------

// A normal window (title bar, taskbar button) for bigger edits and settings.
// Created on demand and destroyed on close; nothing is lost since state lives here.
function openEditor() {
  if (editor && !editor.isDestroyed()) {
    if (editor.isMinimized()) editor.restore();
    return editor.focus();
  }
  editor = new BrowserWindow({
    width: 760,
    height: 640,
    minWidth: 520,
    minHeight: 360,
    title: 'Quest Tracker — Editor',
    icon: makeIcon(),
    autoHideMenuBar: true,
    backgroundColor: BG,
    show: false,
    webPreferences: { preload: PRELOAD },
  });
  editor.setMenu(null);
  editor.on('page-title-updated', (e) => e.preventDefault()); // keep "— Editor" in the title
  editor.once('ready-to-show', () => editor.show());
  editor.on('closed', () => (editor = null));
  load(editor, 'editor');
}

// Launch with Windows. In development there's no installed exe yet, so point
// Windows at electron.exe plus this project folder.
function applyLaunchAtStartup(enabled) {
  const args = app.isPackaged ? [] : [app.getAppPath()];
  app.setLoginItemSettings({ openAtLogin: enabled, path: process.execPath, args });
}

// ---- tray popup ------------------------------------------------------------

function createPopup() {
  popup = new BrowserWindow({
    width: 340,
    height: 480,
    frame: false,
    show: false,
    skipTaskbar: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    alwaysOnTop: true,
    backgroundColor: BG,
    webPreferences: { preload: PRELOAD },
  });
  popup.setAlwaysOnTop(true, 'pop-up-menu');
  popup.on('blur', () => {
    // Clicking elsewhere closes an unpinned popup, unless the mouse is still over it.
    if (!pop.pinned && !contains(popup.getBounds(), screen.getCursorScreenPoint())) hidePopup();
  });
  popup.on('close', (e) => {
    if (!quitting) {
      e.preventDefault();
      hidePopup();
    }
  });
  load(popup, 'popup');
}

function positionPopup() {
  const tb = tray.getBounds();
  const anchor = tb.width ? { x: tb.x + tb.width / 2, y: tb.y + tb.height / 2 } : screen.getCursorScreenPoint();
  const wa = screen.getDisplayNearestPoint(anchor).workArea;
  const [w, h] = popup.getSize();
  const m = 8;
  const x = clamp(Math.round(anchor.x - w / 2), wa.x + m, wa.x + wa.width - w - m);
  let y;
  if (anchor.y >= wa.y + wa.height) y = wa.y + wa.height - h - m; // taskbar at bottom
  else if (anchor.y < wa.y) y = wa.y + m; // taskbar at top
  else y = clamp(Math.round(anchor.y - h / 2), wa.y + m, wa.y + wa.height - h - m); // side taskbar
  popup.setPosition(x, y, false);
}

function setPinned(pinned) {
  pop.pinned = pinned;
  popup.webContents.send('popup:pinned', pinned);
}

function showPopup({ focus = false } = {}) {
  if (!popup.isVisible()) {
    positionPopup();
    popup.showInactive(); // never steal focus from the game on plain hover
  }
  if (focus) popup.focus();
  pop.outsideSince = null;
  if (!pop.poll) pop.poll = setInterval(pollPointer, POLL_MS);
}

function hidePopup() {
  clearInterval(pop.poll);
  pop.poll = null;
  pop.editing = false;
  if (pop.pinned) setPinned(false);
  if (!popup.isDestroyed()) popup.hide();
}

// Tray mouse-leave alone can't tell "moved into the popup" from "moved away",
// so while open we watch the cursor and close after it's been outside both
// the tray icon and the popup for CLOSE_DELAY_MS.
function pollPointer() {
  if (!popup.isVisible()) return hidePopup();
  if (pop.pinned || pop.editing) {
    pop.outsideSince = null;
    return;
  }
  const p = screen.getCursorScreenPoint();
  const inside = contains(popup.getBounds(), p, 2) || contains(tray.getBounds(), p, 2);
  if (inside) pop.outsideSince = null;
  else if (pop.outsideSince === null) pop.outsideSince = Date.now();
  else if (Date.now() - pop.outsideSince >= CLOSE_DELAY_MS) hidePopup();
}

function scheduleOpen() {
  if (popup.isVisible() || pop.openTimer) return;
  pop.openTimer = setTimeout(() => {
    pop.openTimer = null;
    const tb = tray.getBounds();
    // If bounds are known, only open if the cursor is still on the icon.
    if (!tb.width || contains(tb, screen.getCursorScreenPoint(), 2)) showPopup();
  }, OPEN_DELAY_MS);
}

function createTray() {
  tray = new Tray(makeIcon());
  tray.setToolTip('Quest Tracker');
  tray.on('mouse-enter', scheduleOpen);
  tray.on('mouse-move', scheduleOpen); // fallback if mouse-enter is missed
  tray.on('mouse-leave', () => {
    clearTimeout(pop.openTimer);
    pop.openTimer = null;
  });
  tray.on('click', () => {
    clearTimeout(pop.openTimer);
    pop.openTimer = null;
    if (popup.isVisible() && pop.pinned) return hidePopup();
    showPopup({ focus: true });
    setPinned(true);
  });
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: 'Open editor…', click: openEditor },
      { label: 'Show desktop widget', click: showWidget },
      { label: 'Open popup (pinned)', click: () => (showPopup({ focus: true }), setPinned(true)) },
      { type: 'separator' },
      { label: 'Quit Quest Tracker', click: () => app.quit() },
    ]),
  );
}

// ---- IPC -------------------------------------------------------------------

function registerIpc() {
  ipcMain.handle('state:get', () => store.get());
  ipcMain.handle('state:dispatch', (_e, action) => store.dispatch(action));
  ipcMain.on('popup:pin', (_e, pinned) => {
    setPinned(!!pinned);
    if (pinned) popup.focus();
  });
  ipcMain.on('popup:editing', (_e, editing) => (pop.editing = !!editing));
  ipcMain.on('editor:open', () => {
    if (popup.isVisible()) hidePopup();
    openEditor();
  });
  ipcMain.on('data:openFolder', () => shell.openPath(app.getPath('userData')));
  ipcMain.on('window:hide', (e) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    if (win === popup) hidePopup();
    else win?.hide();
  });

  store.subscribe((state, action) => {
    broadcast('state:changed', state);
    if (action.type !== 'settings.update') return;
    if (widget && !widget.isDestroyed()) widget.setOpacity(state.settings.opacity);
    if (typeof action.patch?.launchAtStartup === 'boolean') applyLaunchAtStartup(state.settings.launchAtStartup);
  });
}

// ---- lifecycle -------------------------------------------------------------

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  // Launching again (e.g. from a shortcut) shows the app; `--editor` opens the editor.
  app.on('second-instance', (_e, argv) => (argv.includes('--editor') ? openEditor() : showWidget()));
  app.whenReady().then(() => {
    app.setAppUserModelId('com.sidequest.questtracker');
    store.init();
    registerIpc();
    createWidget();
    createPopup();
    createTray();
    if (process.argv.includes('--editor')) openEditor();
  });
  app.on('before-quit', () => {
    quitting = true;
    store.flush();
  });
  app.on('window-all-closed', () => {
    /* keep running in the tray */
  });
}
