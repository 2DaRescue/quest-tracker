import { Injectable, signal } from '@angular/core';
import { Action, AppState } from './model';

/** Mirrors the main-process state; every window gets the same updates. */
@Injectable({ providedIn: 'root' })
export class QuestStore {
  readonly api = window.questApi;
  readonly available = !!this.api;
  readonly state = signal<AppState | null>(null);

  constructor() {
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
