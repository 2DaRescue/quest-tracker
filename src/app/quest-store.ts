import { Injectable, signal } from '@angular/core';
import { Action, AppState } from './model';

/** Mirrors the main-process state; every window gets the same updates. */
@Injectable({ providedIn: 'root' })
export class QuestStore {
  readonly api = window.questApi;
  readonly available = !!this.api;
  readonly state = signal<AppState | null>(null);

  /** Current time for countdowns; minute precision is plenty. */
  readonly now = signal(Date.now());

  /** The editor window always shows editing controls; elsewhere they're switched on per game. */
  readonly alwaysEdit = location.hash === '#editor';
  private readonly editingGames = signal<ReadonlySet<string>>(new Set());

  isEditing(gameId: string): boolean {
    return this.alwaysEdit || this.editingGames().has(gameId);
  }

  /** True when any game shows its editing controls (e.g. to offer "+ game"). */
  anyEditing(): boolean {
    return this.alwaysEdit || this.editingGames().size > 0;
  }

  setEditing(gameId: string, on: boolean) {
    this.editingGames.update((s) => {
      const next = new Set(s);
      if (on) next.add(gameId);
      else next.delete(gameId);
      return next;
    });
  }

  constructor() {
    setInterval(() => this.now.set(Date.now()), 20_000);
    if (!this.api) return;
    this.api.getState().then((s) => this.state.set(s));
    this.api.onState((s) => this.state.set(s));
  }

  async dispatch(action: Action): Promise<string | null> {
    if (!this.api) return null;
    const { state, createdId } = await this.api.dispatch(action);
    this.state.set(state);
    return createdId;
  }
}
