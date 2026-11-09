import { describe, expect, it } from 'vitest';
import { Group, groupProgress, taskProgress } from './model';

describe('progress', () => {
  it('counts checkboxes, completed counters and remaining entries', () => {
    expect(taskProgress({ id: 'a', name: 'D1', kind: 'check', checked: true })).toEqual({ done: 1, total: 1 });
    expect(taskProgress({ id: 'b', name: 'Clears', kind: 'counter', value: 2, target: 5 })).toEqual({ done: 2, total: 5 });
    // 3 of 5 entries left means 2 have been used
    expect(taskProgress({ id: 'c', name: 'Entries', kind: 'remaining', value: 3, target: 5 })).toEqual({ done: 2, total: 5 });
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
