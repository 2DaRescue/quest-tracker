// Store tests. Runs the real store against a temp folder with a stand-in `electron` module.
const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

let dir;
const realLoad = Module._load;
Module._load = (req, ...rest) => (req === 'electron' ? { app: { getPath: () => dir } } : realLoad(req, ...rest));

const STORE = require.resolve('./store.cjs');
const dataFile = () => path.join(dir, 'quest-tracker.json');

/** A fresh store module (it keeps module-level state), optionally starting from saved data. */
let current = null;
function loadStore(saved) {
  delete require.cache[STORE];
  if (saved) fs.writeFileSync(dataFile(), JSON.stringify(saved));
  current = require(STORE);
  current.init();
  return current;
}

const UTC = { timezone: 'UTC', dailyTime: '00:00', weeklyDay: 1, weeklyTime: '00:00' };
const DAY = 86_400_000;

function v3(groups, extra = {}) {
  return {
    version: 3,
    games: [{ id: 'g1', name: 'Game', collapsed: false, reset: UTC, groups, characters: [], ...extra }],
    settings: { opacity: 1, widgetBounds: null },
    resetLog: [],
  };
}

beforeEach(() => (dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qt-test-'))));
afterEach(() => {
  current?.flush(); // write any pending debounced save before the folder goes away
  current = null;
  fs.rmSync(dir, { recursive: true, force: true });
});

test('migrates a v1 file, keeps a backup, guesses cadence from group names', () => {
  const store = loadStore({
    version: 1,
    games: [
      {
        id: 'g1',
        name: 'Old',
        collapsed: false,
        groups: [
          { id: 'a', name: 'Daily Quests', collapsed: false, tasks: [{ id: 't', name: 'D1', kind: 'check', checked: true }] },
          { id: 'b', name: 'Weekly Bosses', collapsed: false, tasks: [] },
          { id: 'c', name: 'Dungeons', collapsed: false, tasks: [] },
        ],
      },
    ],
    settings: { opacity: 1, widgetBounds: null },
  });
  const s = store.get();
  assert.equal(s.version, 3);
  assert.deepEqual(s.games[0].characters, []);
  assert.deepEqual(s.games[0].groups.map((g) => g.cadence), ['daily', 'weekly', 'none']);
  assert.equal(s.games[0].groups[0].tasks[0].checked, true, 'migration never resets progress');
  assert.ok(fs.existsSync(`${dataFile()}.v1.bak`));
  assert.equal(JSON.parse(fs.readFileSync(dataFile())).version, 3, 'saved right away');
});

test('characters: add, copy group to character, duplicate, delete', () => {
  const store = loadStore(
    v3([{ id: 'gr', name: 'Bosses', collapsed: false, cadence: 'weekly', periodStart: null, tasks: [
      { id: 't1', name: 'B1', kind: 'check', checked: true },
      { id: 't2', name: 'E', kind: 'remaining', value: 1, target: 5 },
    ] }]),
  );
  const main = store.dispatch({ type: 'character.add', gameId: 'g1' }).createdId;
  store.dispatch({ type: 'group.duplicate', groupId: 'gr', targetId: main });
  const copied = store.get().games[0].characters[0].groups[0];
  assert.equal(copied.name, 'Bosses');
  assert.notEqual(copied.id, 'gr');
  assert.equal(copied.cadence, 'weekly');
  assert.equal(copied.tasks[0].checked, false, 'progress reset on copy');
  assert.equal(copied.tasks[1].value, 5, 'entries refilled on copy');

  const alt = store.dispatch({ type: 'character.duplicate', characterId: main }).createdId;
  assert.equal(store.get().games[0].characters[1].id, alt);
  store.dispatch({ type: 'node.delete', id: main });
  assert.equal(store.get().games[0].characters.length, 1);
  assert.equal(store.get().games[0].groups.length, 1, 'shared group untouched');
});

test('drag-and-drop moves', () => {
  const store = loadStore(
    v3([
      { id: 'x', name: 'X', collapsed: false, cadence: 'none', periodStart: null, tasks: [{ id: 't', name: 'T', kind: 'check', checked: false }] },
      { id: 'y', name: 'Y', collapsed: false, cadence: 'none', periodStart: null, tasks: [] },
    ]),
  );
  store.dispatch({ type: 'node.move', kind: 'group', id: 'y', toParentId: 'g1', index: 0 });
  assert.deepEqual(store.get().games[0].groups.map((g) => g.id), ['y', 'x']);
  store.dispatch({ type: 'node.move', kind: 'task', id: 't', toParentId: 'y', index: 99 });
  assert.deepEqual(store.get().games[0].groups[0].tasks.map((t) => t.id), ['t']);
});

test('a due daily reset clears progress exactly once', () => {
  const store = loadStore(
    v3([{ id: 'd', name: 'Dailies', collapsed: false, cadence: 'daily', periodStart: null, tasks: [
      { id: 'c', name: 'D1', kind: 'check', checked: false },
      { id: 'n', name: 'Runs', kind: 'counter', value: 0, target: 5 },
      { id: 'r', name: 'Entries', kind: 'remaining', value: 5, target: 5 },
    ] }]),
  );
  // Make progress, then jump a day ahead.
  store.dispatch({ type: 'task.toggle', taskId: 'c' });
  store.dispatch({ type: 'task.adjust', taskId: 'n', delta: 1 });
  store.dispatch({ type: 'task.adjust', taskId: 'r', delta: -1 });
  const tomorrow = Date.now() + DAY;
  store.tick(tomorrow);
  let g = store.get().games[0].groups[0];
  assert.equal(g.tasks[0].checked, false);
  assert.equal(g.tasks[1].value, 0);
  assert.equal(g.tasks[2].value, 5, 'entries refill');
  assert.equal(store.get().resetLog.length, 1);

  // Progress made after the reset survives another check in the same period.
  store.dispatch({ type: 'task.toggle', taskId: 'c' });
  store.tick(tomorrow + 1000);
  g = store.get().games[0].groups[0];
  assert.equal(g.tasks[0].checked, true, 'idempotent within a period');
  assert.equal(store.get().resetLog.length, 1);
});

test('resets missed while the app was closed are applied on startup', () => {
  const lastWeek = Date.now() - 8 * DAY;
  const store = loadStore(
    v3([
      { id: 'd', name: 'Dailies', collapsed: false, cadence: 'daily', periodStart: lastWeek, tasks: [{ id: 'c', name: 'D1', kind: 'check', checked: true }] },
      { id: 'm', name: 'Manual', collapsed: false, cadence: 'none', periodStart: null, tasks: [{ id: 'k', name: 'K', kind: 'check', checked: true }] },
    ]),
  );
  const [daily, manual] = store.get().games[0].groups;
  assert.equal(daily.tasks[0].checked, false, '8 days of missed resets → one reset');
  assert.equal(manual.tasks[0].checked, true, 'manual groups untouched');
  assert.equal(store.get().resetLog.length, 1);
});

test('changing the schedule or cadence never triggers a surprise reset', () => {
  const store = loadStore(
    v3([{ id: 'd', name: 'Dailies', collapsed: false, cadence: 'none', periodStart: null, tasks: [{ id: 'c', name: 'D1', kind: 'check', checked: true }] }]),
  );
  store.dispatch({ type: 'group.setCadence', groupId: 'd', cadence: 'daily' });
  store.dispatch({ type: 'game.setReset', gameId: 'g1', patch: { dailyTime: '23:59', timezone: 'Asia/Tokyo' } });
  store.tick();
  const g = store.get().games[0];
  assert.equal(g.groups[0].tasks[0].checked, true);
  assert.equal(g.reset.timezone, 'Asia/Tokyo');
  assert.equal(g.reset.dailyTime, '23:59');

  store.dispatch({ type: 'game.setReset', gameId: 'g1', patch: { timezone: 'Not/AZone', dailyTime: '25:00', weeklyDay: 9 } });
  assert.deepEqual(store.get().games[0].reset, { ...UTC, timezone: 'Asia/Tokyo', dailyTime: '23:59' }, 'bad input ignored');
});

test('view includes next reset times; saved file does not', () => {
  const store = loadStore(v3([]));
  const next = store.get().next.g1;
  assert.ok(next.daily > Date.now() && next.daily <= Date.now() + DAY);
  assert.ok(next.weekly > Date.now() && next.weekly <= Date.now() + 7 * DAY);
  store.dispatch({ type: 'game.add' });
  store.flush();
  assert.equal(JSON.parse(fs.readFileSync(dataFile())).next, undefined);
});
