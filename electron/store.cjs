// Single source of truth for app state. Lives in the Electron main process;
// every window gets a copy over IPC and sends actions back here.
const { app } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const { latestBoundary, nextBoundary, nextOccurrence, isValidTimeZone, defaultResetConfig } = require('./schedule.cjs');

const SCHEMA_VERSION = 5;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const MAX_TIMER_TIMES = 48;
const MIN_OPACITY = 0.4;
const RESET_LOG_MAX = 200;
const CADENCES = ['none', 'daily', 'weekly'];

let state;
let file;
let saveTimer = null;
const listeners = new Set();

const id = () => crypto.randomUUID();

function seed() {
  const check = (name) => ({ id: id(), name, kind: 'check', checked: false });
  const group = (name, cadence, tasks) => ({ id: id(), name, collapsed: false, cadence, periodStart: null, tasks });
  return {
    version: SCHEMA_VERSION,
    games: [
      {
        id: id(),
        name: 'Example Game',
        collapsed: false,
        reset: defaultResetConfig(),
        groups: [
          group('Daily Quests', 'daily', ['D1', 'D2', 'D3', 'D4', 'D5'].map(check)),
          {
            id: id(),
            name: 'Dungeons',
            collapsed: false,
            cadence: 'daily',
            periodStart: null,
            tasks: [
              { id: id(), name: 'Dungeon clears', kind: 'counter', value: 2, target: 5 },
              { id: id(), name: 'Dungeon entries', kind: 'remaining', value: 3, target: 5 },
            ],
          },
          group('Weekly Bosses', 'weekly', ['Ember Drake', 'Hollow King', 'Tide Warden', 'Stone Colossus'].map(check)),
        ],
        characters: [],
        timers: [{ id: id(), name: 'World boss', times: ['12:00', '18:00', '21:00'], days: [], notify: true }],
      },
    ],
    settings: { opacity: 1, widgetBounds: null, hideCompleted: false, launchAtStartup: false },
    resetLog: [],
  };
}

// Upgrade older saved files in place. Each step bumps the version by one.
function migrate(s) {
  if (s.version === 1) {
    for (const game of s.games) game.characters = [];
    s.version = 2;
  }
  if (s.version === 2) {
    // Reset engine: each game gets a schedule; guess each group's cadence from its name.
    for (const game of s.games) {
      game.reset = defaultResetConfig();
      for (const owner of [game, ...game.characters])
        for (const g of owner.groups) {
          g.cadence = /daily|dailies/i.test(g.name) ? 'daily' : /weekly|weeklies/i.test(g.name) ? 'weekly' : 'none';
          g.periodStart = null; // set to the current period on load, so nothing resets immediately
        }
    }
    s.resetLog = [];
    s.version = 3;
  }
  if (s.version === 3) {
    // Characters can be ticked off directly (for people who don't track details).
    for (const game of s.games)
      for (const ch of game.characters) Object.assign(ch, { done: false, cadence: 'daily', periodStart: null });
    s.version = 4;
  }
  if (s.version === 4) {
    for (const game of s.games) game.timers = [];
    s.version = 5;
  }
  return s;
}

function init() {
  file = path.join(app.getPath('userData'), 'quest-tracker.json');
  try {
    // Strip a byte-order mark: Notepad and PowerShell add one when hand-editing the file.
    const loaded = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, ''));
    const oldVersion = loaded?.version;
    if (oldVersion < SCHEMA_VERSION) fs.copyFileSync(file, `${file}.v${oldVersion}.bak`);
    state = migrate(loaded);
    if (state?.version !== SCHEMA_VERSION || !Array.isArray(state.games)) throw new Error('bad schema');
    // Catch up on resets that passed while the app wasn't running.
    if (applyResets(state, Date.now()) || oldVersion !== SCHEMA_VERSION) saveNow();
  } catch (err) {
    if (err.code !== 'ENOENT' && fs.existsSync(file)) {
      // Keep the unreadable file instead of silently overwriting the user's data.
      fs.renameSync(file, `${file}.corrupt-${Date.now()}`);
    }
    state = seed();
    applyResets(state, Date.now());
    saveNow();
  }
  lastNextKey = JSON.stringify(nextResets(state, Date.now()));
}

// ---- reset engine ---------------------------------------------------------

/**
 * Reset every group whose most recent reset boundary is newer than the one it
 * last processed. Idempotent: running it twice in a row changes nothing, and
 * any number of missed boundaries (PC off for a week) collapse into one reset.
 * Returns true if anything changed.
 */
function applyResets(s, now) {
  let changed = false;
  for (const { game, item, reset } of resettables(s)) {
    const boundary = latestBoundary(now, item.cadence, game.reset);
    if (boundary === null) continue;
    if (item.periodStart == null) {
      item.periodStart = boundary; // newly scheduled: start tracking from the current period
      changed = true;
    } else if (boundary > item.periodStart) {
      reset();
      s.resetLog.push({ id: item.id, name: item.name, boundary, at: now });
      item.periodStart = boundary;
      changed = true;
    }
  }
  if (s.resetLog.length > RESET_LOG_MAX) s.resetLog.splice(0, s.resetLog.length - RESET_LOG_MAX);
  return changed;
}

/** Everything with its own reset cadence: groups (clear their tasks) and characters (untick). */
function* resettables(s) {
  for (const { game, owner } of groupOwners(s))
    for (const g of owner.groups) yield { game, item: g, reset: () => g.tasks.forEach(resetTask) };
  for (const game of s.games)
    for (const ch of game.characters) yield { game, item: ch, reset: () => (ch.done = false) };
}

/**
 * Derived, never saved: next daily/weekly reset per game (`next`) and the
 * next time each timer goes off (`timerNext`), for countdowns.
 */
function nextResets(s, now) {
  const next = {};
  const timerNext = {};
  for (const game of s.games) {
    next[game.id] = { daily: nextBoundary(now, 'daily', game.reset), weekly: nextBoundary(now, 'weekly', game.reset) };
    for (const t of game.timers) timerNext[t.id] = nextOccurrence(now, t.times, t.days, game.reset.timezone);
  }
  return { next, timerNext };
}

/** Re-anchor groups after a schedule change so editing a time never triggers a surprise reset. */
function restartPeriods(s, game, now) {
  for (const r of resettables(s)) if (r.game === game) r.item.periodStart = latestBoundary(now, r.item.cadence, game.reset);
}

let lastNextKey = '';

/** Called periodically and on wake. Applies due resets and refreshes countdowns. */
function tick(now = Date.now()) {
  const changed = applyResets(state, now);
  const nextKey = JSON.stringify(nextResets(state, now));
  if (!changed && nextKey === lastNextKey) return;
  lastNextKey = nextKey;
  if (changed) scheduleSave();
  emit({ type: 'tick' });
}

/** What windows see: saved state plus derived countdown targets. */
function view() {
  return { ...state, ...nextResets(state, Date.now()) };
}

function emit(action) {
  const v = view();
  for (const fn of listeners) fn(v, action);
  return v;
}

function saveNow() {
  clearTimeout(saveTimer);
  saveTimer = null;
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
  fs.renameSync(tmp, file); // atomic replace: no half-written file on crash
}

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 250);
}

function flush() {
  if (saveTimer) saveNow();
}

// ---- lookup helpers -------------------------------------------------------

// Groups live either directly on a game (shared/account-wide) or on a character.
function* groupOwners(s) {
  for (const game of s.games) {
    yield { game, owner: game };
    for (const ch of game.characters) yield { game, owner: ch };
  }
}

function findTask(s, taskId) {
  for (const { owner } of groupOwners(s))
    for (const group of owner.groups) {
      const i = group.tasks.findIndex((t) => t.id === taskId);
      if (i >= 0) return { group, task: group.tasks[i], index: i };
    }
  return null;
}

function findGroup(s, groupId) {
  for (const { game, owner } of groupOwners(s)) {
    const i = owner.groups.findIndex((g) => g.id === groupId);
    if (i >= 0) return { game, owner, group: owner.groups[i], index: i };
  }
  return null;
}

function findCharacter(s, characterId) {
  for (const game of s.games) {
    const i = game.characters.findIndex((c) => c.id === characterId);
    if (i >= 0) return { game, character: game.characters[i], index: i };
  }
  return null;
}

/** A game or character — anything that can hold groups. */
function findOwner(s, ownerId) {
  for (const { owner } of groupOwners(s)) if (owner.id === ownerId) return owner;
  return null;
}

function findTimer(s, timerId) {
  for (const game of s.games) {
    const i = game.timers.findIndex((t) => t.id === timerId);
    if (i >= 0) return { game, timer: game.timers[i], index: i };
  }
  return null;
}

function findNode(s, nodeId) {
  return findOwner(s, nodeId) ?? findGroup(s, nodeId)?.group ?? findTimer(s, nodeId)?.timer ?? null;
}

/** "12:00, 6:30pm" or ["12:00"] → sorted unique "HH:MM" list; invalid entries dropped. */
function cleanTimes(input) {
  const raw = Array.isArray(input) ? input : String(input ?? '').split(/[,;\s]+/);
  const out = new Set();
  for (const r of raw) {
    const m = String(r).trim().toLowerCase().match(/^(\d{1,2})(?::?(\d{2}))?\s*(am|pm)?$/);
    if (!m) continue;
    let h = +m[1];
    const mi = +(m[2] ?? 0);
    if (m[3] === 'pm' && h < 12) h += 12;
    if (m[3] === 'am' && h === 12) h = 0;
    const t = `${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}`;
    if (TIME_RE.test(t)) out.add(t);
  }
  return [...out].sort().slice(0, MAX_TIMER_TIMES);
}

/** The list an item currently lives in, and its position there. */
function locate(s, kind, itemId) {
  if (kind === 'game') {
    const index = s.games.findIndex((g) => g.id === itemId);
    return index >= 0 ? { list: s.games, index } : null;
  }
  if (kind === 'character') {
    const f = findCharacter(s, itemId);
    return f && { list: f.game.characters, index: f.index };
  }
  if (kind === 'group') {
    const f = findGroup(s, itemId);
    return f && { list: f.owner.groups, index: f.index };
  }
  if (kind === 'task') {
    const f = findTask(s, itemId);
    return f && { list: f.group.tasks, index: f.index };
  }
  return null;
}

/** The list under `parentId` that holds items of `kind`. */
function childList(s, kind, parentId) {
  if (kind === 'game') return s.games;
  if (kind === 'character') return s.games.find((g) => g.id === parentId)?.characters ?? null;
  if (kind === 'group') return findOwner(s, parentId)?.groups ?? null;
  if (kind === 'task') return findGroup(s, parentId)?.group.tasks ?? null;
  return null;
}

/** Deep copy with fresh ids and progress reset, e.g. for another character. */
function cloneGroup(group) {
  const copy = structuredClone(group);
  copy.id = id();
  copy.periodStart = null; // picks up the current period on the next reset check
  for (const t of copy.tasks) {
    t.id = id();
    resetTask(t);
  }
  return copy;
}

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const cleanName = (n, fallback) => (typeof n === 'string' && n.trim() ? n.trim().slice(0, 80) : fallback);

function resetTask(t) {
  if (t.kind === 'check') t.checked = false;
  else if (t.kind === 'counter') t.value = 0;
  else if (t.kind === 'remaining') t.value = t.target;
}

// ---- reducer --------------------------------------------------------------

function reduce(s, a) {
  let createdId = null;
  switch (a.type) {
    case 'task.toggle': {
      const f = findTask(s, a.taskId);
      if (f?.task.kind === 'check') f.task.checked = !f.task.checked;
      break;
    }
    case 'task.adjust': {
      const f = findTask(s, a.taskId);
      if (f && f.task.kind !== 'check') f.task.value = clamp(f.task.value + Math.sign(a.delta), 0, f.task.target);
      break;
    }
    case 'task.setTarget': {
      const f = findTask(s, a.taskId);
      if (f && f.task.kind !== 'check') {
        f.task.target = clamp(Math.round(a.target) || 1, 1, 999);
        f.task.value = clamp(f.task.value, 0, f.task.target);
      }
      break;
    }
    case 'task.rename': {
      const f = findTask(s, a.taskId);
      if (f) f.task.name = cleanName(a.name, f.task.name);
      break;
    }
    case 'task.add': {
      const f = findGroup(s, a.groupId);
      if (!f) break;
      const kind = ['check', 'counter', 'remaining'].includes(a.kind) ? a.kind : 'check';
      const task = { id: id(), name: 'New task', kind };
      if (kind === 'check') task.checked = false;
      else Object.assign(task, { target: 5, value: kind === 'remaining' ? 5 : 0 });
      f.group.tasks.push(task);
      f.group.collapsed = false;
      createdId = task.id;
      break;
    }
    case 'task.delete': {
      const f = findTask(s, a.taskId);
      if (f) f.group.tasks.splice(f.index, 1);
      break;
    }
    case 'group.add': {
      const owner = findOwner(s, a.parentId);
      if (!owner) break;
      const group = { id: id(), name: 'New group', collapsed: false, cadence: 'none', periodStart: null, tasks: [] };
      owner.groups.push(group);
      owner.collapsed = false;
      createdId = group.id;
      break;
    }
    case 'group.duplicate': {
      const f = findGroup(s, a.groupId);
      const target = findOwner(s, a.targetId ?? f?.owner.id);
      if (!f || !target) break;
      const copy = cloneGroup(f.group);
      if (target === f.owner) copy.name = `${f.group.name} (copy)`;
      target.groups.push(copy);
      target.collapsed = false;
      createdId = copy.id;
      break;
    }
    case 'character.add': {
      const game = s.games.find((g) => g.id === a.gameId);
      if (!game) break;
      const character = {
        id: id(),
        name: 'New character',
        collapsed: false,
        done: false,
        cadence: 'daily',
        periodStart: null,
        groups: [],
      };
      game.characters.push(character);
      game.collapsed = false;
      createdId = character.id;
      break;
    }
    case 'character.duplicate': {
      // Same dailies/bosses for an alt: copy every group, progress reset.
      const f = findCharacter(s, a.characterId);
      if (!f) break;
      const copy = {
        id: id(),
        name: `${f.character.name} (copy)`,
        collapsed: false,
        done: false,
        cadence: f.character.cadence,
        periodStart: null,
        groups: f.character.groups.map(cloneGroup),
      };
      f.game.characters.splice(f.index + 1, 0, copy);
      createdId = copy.id;
      break;
    }
    case 'group.resetNow': {
      const f = findGroup(s, a.groupId);
      f?.group.tasks.forEach(resetTask);
      break;
    }
    case 'game.add': {
      const game = {
        id: id(),
        name: 'New game',
        collapsed: false,
        reset: defaultResetConfig(),
        groups: [],
        characters: [],
        timers: [],
      };
      s.games.push(game);
      createdId = game.id;
      break;
    }
    case 'node.rename': {
      const n = findNode(s, a.id);
      if (n) n.name = cleanName(a.name, n.name);
      break;
    }
    case 'node.delete': {
      const gi = s.games.findIndex((g) => g.id === a.id);
      if (gi >= 0) {
        s.games.splice(gi, 1);
        break;
      }
      const c = findCharacter(s, a.id);
      if (c) {
        c.game.characters.splice(c.index, 1);
        break;
      }
      const t = findTimer(s, a.id);
      if (t) {
        t.game.timers.splice(t.index, 1);
        break;
      }
      const f = findGroup(s, a.id);
      if (f) f.owner.groups.splice(f.index, 1);
      break;
    }
    case 'timer.add': {
      const game = s.games.find((g) => g.id === a.gameId);
      if (!game) break;
      const timer = { id: id(), name: 'New timer', times: ['12:00'], days: [], notify: true };
      game.timers.push(timer);
      game.collapsed = false;
      createdId = timer.id;
      break;
    }
    case 'timer.update': {
      const f = findTimer(s, a.timerId);
      if (!f) break;
      const p = a.patch ?? {};
      if (p.times !== undefined) {
        const times = cleanTimes(p.times);
        if (times.length) f.timer.times = times; // never leave a timer with nothing to fire on
      }
      if (Array.isArray(p.days)) f.timer.days = [...new Set(p.days.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort();
      if (typeof p.notify === 'boolean') f.timer.notify = p.notify;
      if (typeof p.name === 'string') f.timer.name = cleanName(p.name, f.timer.name);
      break;
    }
    case 'node.toggleCollapse': {
      const n = findNode(s, a.id);
      if (n) n.collapsed = !n.collapsed;
      break;
    }
    case 'node.move': {
      // Drag-and-drop: take the item out of its list, insert into the target
      // parent's list at `index` (index counted with the item already removed).
      const src = locate(s, a.kind, a.id);
      const dest = childList(s, a.kind, a.toParentId);
      if (!src || !dest) break;
      const fromGame = a.kind === 'group' ? findGroup(s, a.id).game : null;
      const [item] = src.list.splice(src.index, 1);
      dest.splice(clamp(a.index, 0, dest.length), 0, item);
      // A group moved to another game follows that game's schedule from now on.
      if (fromGame && findGroup(s, a.id).game !== fromGame) item.periodStart = null;
      break;
    }
    case 'game.setReset': {
      const game = s.games.find((g) => g.id === a.gameId);
      if (!game) break;
      const p = a.patch ?? {};
      const time = (v) => typeof v === 'string' && TIME_RE.test(v);
      if (typeof p.timezone === 'string' && isValidTimeZone(p.timezone)) game.reset.timezone = p.timezone;
      if (time(p.dailyTime)) game.reset.dailyTime = p.dailyTime;
      if (time(p.weeklyTime)) game.reset.weeklyTime = p.weeklyTime;
      if (Number.isInteger(p.weeklyDay) && p.weeklyDay >= 0 && p.weeklyDay <= 6) game.reset.weeklyDay = p.weeklyDay;
      restartPeriods(s, game, Date.now());
      break;
    }
    case 'group.setCadence': {
      const f = findGroup(s, a.groupId);
      if (!f || !CADENCES.includes(a.cadence)) break;
      f.group.cadence = a.cadence;
      f.group.periodStart = latestBoundary(Date.now(), a.cadence, f.game.reset);
      break;
    }
    case 'character.toggle': {
      const f = findCharacter(s, a.characterId);
      if (f) f.character.done = !f.character.done;
      break;
    }
    case 'character.setCadence': {
      const f = findCharacter(s, a.characterId);
      if (!f || !CADENCES.includes(a.cadence)) break;
      f.character.cadence = a.cadence;
      f.character.periodStart = latestBoundary(Date.now(), a.cadence, f.game.reset);
      break;
    }
    case 'settings.update': {
      const p = a.patch ?? {};
      if (typeof p.hideCompleted === 'boolean') s.settings.hideCompleted = p.hideCompleted;
      if (typeof p.launchAtStartup === 'boolean') s.settings.launchAtStartup = p.launchAtStartup;
      if (typeof p.opacity === 'number') s.settings.opacity = clamp(p.opacity, MIN_OPACITY, 1);
      if (p.widgetBounds) s.settings.widgetBounds = p.widgetBounds;
      break;
    }
    default:
      console.warn('Unknown action', a?.type);
  }
  return createdId;
}

function dispatch(action) {
  const next = structuredClone(state);
  const createdId = reduce(next, action);
  applyResets(next, Date.now()); // anchor new/copied groups to the current period
  state = next;
  lastNextKey = JSON.stringify(nextResets(state, Date.now()));
  scheduleSave();
  return { state: emit(action), createdId };
}

module.exports = {
  init,
  flush,
  dispatch,
  tick,
  get: view,
  subscribe: (fn) => (listeners.add(fn), () => listeners.delete(fn)),
};
