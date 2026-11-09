// Single source of truth for app state. Lives in the Electron main process;
// every window gets a copy over IPC and sends actions back here.
const { app } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const SCHEMA_VERSION = 2;
const MIN_OPACITY = 0.4;

let state;
let file;
let saveTimer = null;
const listeners = new Set();

const id = () => crypto.randomUUID();

function seed() {
  const check = (name) => ({ id: id(), name, kind: 'check', checked: false });
  return {
    version: SCHEMA_VERSION,
    games: [
      {
        id: id(),
        name: 'Example Game',
        collapsed: false,
        groups: [
          {
            id: id(),
            name: 'Daily Quests',
            collapsed: false,
            tasks: ['D1', 'D2', 'D3', 'D4', 'D5'].map(check),
          },
          {
            id: id(),
            name: 'Dungeons',
            collapsed: false,
            tasks: [
              { id: id(), name: 'Dungeon clears', kind: 'counter', value: 2, target: 5 },
              { id: id(), name: 'Dungeon entries', kind: 'remaining', value: 3, target: 5 },
            ],
          },
          {
            id: id(),
            name: 'Weekly Bosses',
            collapsed: false,
            tasks: ['Ember Drake', 'Hollow King', 'Tide Warden', 'Stone Colossus'].map(check),
          },
        ],
        characters: [],
      },
    ],
    settings: { opacity: 1, widgetBounds: null },
  };
}

// Upgrade older saved files in place. Each step bumps the version by one.
function migrate(s) {
  if (s.version === 1) {
    for (const game of s.games) game.characters = [];
    s.version = 2;
  }
  return s;
}

function init() {
  file = path.join(app.getPath('userData'), 'quest-tracker.json');
  try {
    const loaded = JSON.parse(fs.readFileSync(file, 'utf8'));
    const oldVersion = loaded?.version;
    if (oldVersion < SCHEMA_VERSION) fs.copyFileSync(file, `${file}.v${oldVersion}.bak`);
    state = migrate(loaded);
    if (state?.version !== SCHEMA_VERSION || !Array.isArray(state.games)) throw new Error('bad schema');
    if (oldVersion !== SCHEMA_VERSION) saveNow();
  } catch (err) {
    if (err.code !== 'ENOENT' && fs.existsSync(file)) {
      // Keep the unreadable file instead of silently overwriting the user's data.
      fs.renameSync(file, `${file}.corrupt-${Date.now()}`);
    }
    state = seed();
    saveNow();
  }
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

function findNode(s, nodeId) {
  return findOwner(s, nodeId) ?? findGroup(s, nodeId)?.group ?? null;
}

/** Deep copy with fresh ids and progress reset, e.g. for another character. */
function cloneGroup(group) {
  const copy = structuredClone(group);
  copy.id = id();
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
      const group = { id: id(), name: 'New group', collapsed: false, tasks: [] };
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
      const character = { id: id(), name: 'New character', collapsed: false, groups: [] };
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
      const game = { id: id(), name: 'New game', collapsed: false, groups: [], characters: [] };
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
      const f = findGroup(s, a.id);
      if (f) f.owner.groups.splice(f.index, 1);
      break;
    }
    case 'node.toggleCollapse': {
      const n = findNode(s, a.id);
      if (n) n.collapsed = !n.collapsed;
      break;
    }
    case 'settings.update': {
      const p = a.patch ?? {};
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
  state = next;
  scheduleSave();
  for (const fn of listeners) fn(state, action);
  return { state, createdId };
}

module.exports = {
  init,
  flush,
  dispatch,
  get: () => state,
  subscribe: (fn) => (listeners.add(fn), () => listeners.delete(fn)),
};
