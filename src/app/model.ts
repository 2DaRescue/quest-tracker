export type TaskKind = 'check' | 'counter' | 'remaining';

export interface Task {
  id: string;
  name: string;
  kind: TaskKind;
  checked?: boolean; // check
  value?: number; // counter: completed so far; remaining: entries left
  target?: number; // counter / remaining: maximum
}

export interface Group {
  id: string;
  name: string;
  collapsed: boolean;
  tasks: Task[];
}

export interface Character {
  id: string;
  name: string;
  collapsed: boolean;
  groups: Group[];
}

export interface Game {
  id: string;
  name: string;
  collapsed: boolean;
  groups: Group[]; // shared across the account
  characters: Character[];
}

export interface Settings {
  opacity: number;
  widgetBounds: { x: number; y: number; width: number; height: number } | null;
}

export interface AppState {
  version: number;
  games: Game[];
  settings: Settings;
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
  | { type: 'group.resetNow'; groupId: string }
  | { type: 'game.add' }
  | { type: 'node.rename'; id: string; name: string }
  | { type: 'node.delete'; id: string }
  | { type: 'node.toggleCollapse'; id: string }
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

export function sumProgress(items: Progress[]): Progress {
  return items.reduce((a, p) => ({ done: a.done + p.done, total: a.total + p.total }), { done: 0, total: 0 });
}

export const groupProgress = (g: Group) => sumProgress(g.tasks.map(taskProgress));
export const characterProgress = (c: Character) => sumProgress(c.groups.map(groupProgress));
export const gameProgress = (g: Game) =>
  sumProgress([...g.groups.map(groupProgress), ...g.characters.map(characterProgress)]);
