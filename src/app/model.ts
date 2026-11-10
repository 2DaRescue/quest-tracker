export type TaskKind = 'check' | 'counter' | 'remaining';

export interface Task {
  id: string;
  name: string;
  kind: TaskKind;
  checked?: boolean; // check
  value?: number; // counter: completed so far; remaining: entries left
  target?: number; // counter / remaining: maximum
}

export type Cadence = 'none' | 'daily' | 'weekly';

export interface Group {
  id: string;
  name: string;
  collapsed: boolean;
  cadence: Cadence;
  periodStart: number | null; // last reset boundary applied (ms)
  tasks: Task[];
}

export interface ResetConfig {
  timezone: string; // IANA, e.g. "America/New_York" or "UTC"
  dailyTime: string; // "HH:MM" in that time zone
  weeklyDay: number; // 0 = Sunday … 6 = Saturday
  weeklyTime: string;
}

export interface Character {
  id: string;
  name: string;
  collapsed: boolean;
  /** Ticked off directly — used when the character has no groups. */
  done: boolean;
  cadence: Cadence;
  periodStart: number | null;
  groups: Group[];
}

export interface Game {
  id: string;
  name: string;
  collapsed: boolean;
  reset: ResetConfig;
  groups: Group[]; // shared across the account
  characters: Character[];
  timers: Timer[];
}

/** An event at fixed clock times, e.g. a world boss. Times are in the game's time zone. */
export interface Timer {
  id: string;
  name: string;
  times: string[]; // "HH:MM", sorted
  days: number[]; // 0 = Sunday … 6; empty = every day
  notify: boolean;
}

export interface Settings {
  opacity: number;
  widgetBounds: { x: number; y: number; width: number; height: number } | null;
  hideCompleted?: boolean;
  launchAtStartup?: boolean;
  /** Ask before deleting games/characters/groups/timers. Missing = true. */
  confirmDelete?: boolean;
}

export type NodeKind = 'game' | 'character' | 'group' | 'task';

export interface AppState {
  version: number;
  games: Game[];
  settings: Settings;
  /** Derived by the main process: next reset instants (ms) per game id. */
  next: Record<string, { daily: number; weekly: number }>;
  /** Derived: when each timer goes off next (ms), by timer id. */
  timerNext: Record<string, number | null>;
}

export type Action =
  | { type: 'task.toggle'; taskId: string }
  | { type: 'task.adjust'; taskId: string; delta: 1 | -1 }
  | { type: 'task.setTarget'; taskId: string; target: number }
  | { type: 'task.rename'; taskId: string; name: string }
  | { type: 'task.add'; groupId: string; kind: TaskKind }
  | { type: 'task.delete'; taskId: string }
  | { type: 'group.add'; parentId: string }
  | { type: 'group.duplicate'; groupId: string; targetId?: string }
  | { type: 'character.add'; gameId: string }
  | { type: 'character.duplicate'; characterId: string }
  | { type: 'character.toggle'; characterId: string }
  | { type: 'character.setCadence'; characterId: string; cadence: Cadence }
  | { type: 'group.resetNow'; groupId: string }
  | { type: 'group.setCadence'; groupId: string; cadence: Cadence }
  | { type: 'game.setReset'; gameId: string; patch: Partial<ResetConfig> }
  | { type: 'timer.add'; gameId: string }
  | { type: 'timer.update'; timerId: string; patch: Partial<Omit<Timer, 'times'>> & { times?: string | string[] } }
  | { type: 'game.add' }
  | { type: 'node.rename'; id: string; name: string }
  | { type: 'node.delete'; id: string }
  | { type: 'node.toggleCollapse'; id: string }
  | { type: 'node.move'; kind: NodeKind; id: string; toParentId: string | null; index: number }
  | { type: 'settings.update'; patch: Partial<Settings> };

export interface DispatchResult {
  state: AppState;
  createdId: string | null;
}

export interface QuestApi {
  getState(): Promise<AppState>;
  dispatch(action: Action): Promise<DispatchResult>;
  onState(cb: (s: AppState) => void): () => void;
  onPinned(cb: (pinned: boolean) => void): () => void;
  setPinned(pinned: boolean): void;
  setEditing(editing: boolean): void;
  hideWindow(): void;
  openEditor(): void;
  openDataFolder(): void;
}

declare global {
  interface Window {
    questApi?: QuestApi;
  }
}

export interface Progress {
  done: number;
  total: number;
}

/** How much of a task is "done", in units that can be summed into group totals. */
export function taskProgress(t: Task): Progress {
  switch (t.kind) {
    case 'check':
      return { done: t.checked ? 1 : 0, total: 1 };
    case 'counter':
      return { done: t.value ?? 0, total: t.target ?? 0 };
    case 'remaining':
      return { done: (t.target ?? 0) - (t.value ?? 0), total: t.target ?? 0 };
  }
}

/** "42m", "5h 12m", "2d 4h" — compact countdown text. */
export function formatCountdown(ms: number): string {
  const min = Math.max(0, Math.ceil(ms / 60_000));
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h ${min % 60}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

/** Which cadences any group in this game uses (to decide which countdowns to show). */
export function cadencesUsed(game: Game): Set<Cadence> {
  const all: { cadence: Cadence }[] = [
    ...game.groups,
    ...game.characters.flatMap((c): { cadence: Cadence }[] => (c.groups.length ? c.groups : [c])), // simple characters reset themselves
  ];
  return new Set(all.map((g) => g.cadence));
}

/** Simple characters (no groups) are just a checkbox. */
export const isSimpleCharacter = (c: Character) => c.groups.length === 0;

export function isDone(t: Task): boolean {
  const p = taskProgress(t);
  return p.total > 0 && p.done >= p.total;
}

/**
 * Convert a drop position in the *visible* list (some items may be hidden)
 * into an index in the full list with the dragged item removed — the form
 * the store's `node.move` expects.
 */
export function dropIndex<T extends { id: string }>(full: T[], visible: T[], movingId: string, visibleIndex: number): number {
  const fullOthers = full.filter((x) => x.id !== movingId);
  const anchor = visible.filter((x) => x.id !== movingId)[visibleIndex];
  return anchor ? fullOthers.indexOf(anchor) : fullOthers.length;
}

export function sumProgress(items: Progress[]): Progress {
  return items.reduce((a, p) => ({ done: a.done + p.done, total: a.total + p.total }), { done: 0, total: 0 });
}

export const groupProgress = (g: Group) => sumProgress(g.tasks.map(taskProgress));
export const characterProgress = (c: Character): Progress =>
  c.groups.length ? sumProgress(c.groups.map(groupProgress)) : { done: c.done ? 1 : 0, total: 1 };
export const gameProgress = (g: Game) =>
  sumProgress([...g.groups.map(groupProgress), ...g.characters.map(characterProgress)]);
