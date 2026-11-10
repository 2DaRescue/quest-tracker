import { describe, expect, it } from 'vitest';
import { Game, Group, dropIndex, gameProgress, groupProgress, taskProgress } from './model';

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
      tasks: [{ id: 't', name: 'D1', kind: 'check', checked: done }],
    });
    const game: Game = {
      id: 'g',
      name: 'Game',
      collapsed: false,
      groups: [group(true)],
      characters: [
        { id: 'a', name: 'Main', collapsed: false, groups: [group(true)] },
        { id: 'b', name: 'Alt', collapsed: false, groups: [group(false)] },
      ],
    };
    expect(gameProgress(game)).toEqual({ done: 2, total: 3 });
  });

  it('sums a boss list into a group total', () => {
    const bosses: Group = {
      id: 'g',
      name: 'Weekly Bosses',
      collapsed: false,
      tasks: Array.from({ length: 12 }, (_, i) => ({ id: `${i}`, name: `Boss ${i}`, kind: 'check' as const, checked: i < 7 })),
    };
    expect(groupProgress(bosses)).toEqual({ done: 7, total: 12 });
  });
});
