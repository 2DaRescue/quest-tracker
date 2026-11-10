import { describe, expect, it } from 'vitest';
import { Game, Group, dropIndex, formatCountdown, gameProgress, groupProgress, taskProgress } from './model';

describe('formatCountdown', () => {
  it('picks a compact unit', () => {
    expect(formatCountdown(42 * 60_000)).toBe('42m');
    expect(formatCountdown((5 * 60 + 12) * 60_000)).toBe('5h 12m');
    expect(formatCountdown((2 * 24 + 4) * 3_600_000)).toBe('2d 4h');
    expect(formatCountdown(-5000)).toBe('0m');
  });
});

describe('dropIndex', () => {
  const items = ['a', 'b', 'c', 'd', 'e'].map((id) => ({ id }));

  it('matches the visible index when nothing is hidden', () => {
    // move "a" to the end
    expect(dropIndex(items, items, 'a', 4)).toBe(4);
    // move "d" to the top
    expect(dropIndex(items, items, 'd', 0)).toBe(0);
  });

  it('skips over hidden (completed) items', () => {
    const visible = items.filter((x) => x.id !== 'b' && x.id !== 'c'); // a, d, e
    // drag "e" to visible position 1 (just before "d") → full list without e: a b c d → index 3
    expect(dropIndex(items, visible, 'e', 1)).toBe(3);
    // drop into an empty spot at the end of another list
    expect(dropIndex(items, visible, 'zz', 3)).toBe(5);
  });
});

describe('progress', () => {
  it('counts checkboxes, completed counters and remaining entries', () => {
    expect(taskProgress({ id: 'a', name: 'D1', kind: 'check', checked: true })).toEqual({ done: 1, total: 1 });
    expect(taskProgress({ id: 'b', name: 'Clears', kind: 'counter', value: 2, target: 5 })).toEqual({ done: 2, total: 5 });
    // 3 of 5 entries left means 2 have been used
    expect(taskProgress({ id: 'c', name: 'Entries', kind: 'remaining', value: 3, target: 5 })).toEqual({ done: 2, total: 5 });
  });

  it('includes character groups in the game total', () => {
    const group = (done: boolean): Group => ({
      id: 'x',
      name: 'Dailies',
      collapsed: false,
      cadence: 'daily',
      periodStart: null,
      tasks: [{ id: 't', name: 'D1', kind: 'check', checked: done }],
    });
    const game: Game = {
      id: 'g',
      name: 'Game',
      collapsed: false,
      reset: { timezone: 'UTC', dailyTime: '00:00', weeklyDay: 1, weeklyTime: '00:00' },
      timers: [],
      groups: [group(true)],
      characters: [
        { id: 'a', name: 'Main', collapsed: false, done: false, cadence: 'daily', periodStart: null, groups: [group(true)] },
        { id: 'b', name: 'Alt', collapsed: false, done: false, cadence: 'daily', periodStart: null, groups: [group(false)] },
        // A tick-off character with no groups counts as one item.
        { id: 'c', name: 'Mule', collapsed: false, done: true, cadence: 'daily', periodStart: null, groups: [] },
      ],
    };
    expect(gameProgress(game)).toEqual({ done: 3, total: 4 });
  });

  it('sums a boss list into a group total', () => {
    const bosses: Group = {
      id: 'g',
      name: 'Weekly Bosses',
      collapsed: false,
      cadence: 'weekly',
      periodStart: null,
      tasks: Array.from({ length: 12 }, (_, i) => ({ id: `${i}`, name: `Boss ${i}`, kind: 'check' as const, checked: i < 7 })),
    };
    expect(groupProgress(bosses)).toEqual({ done: 7, total: 12 });
  });
});
