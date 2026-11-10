import { Component, computed, inject, signal } from '@angular/core';
import { Board } from './board';
import { QuestStore } from './quest-store';
import { ResetConfig, Settings } from './model';

type Mode = 'widget' | 'popup' | 'editor';

const OPACITY_STEPS = [1, 0.85, 0.7, 0.55];

/** All IANA zones the runtime knows, with UTC first and the user's own zone guaranteed present. */
function listTimeZones(): string[] {
  const local = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const zones = Intl.supportedValuesOf?.('timeZone') ?? [];
  return [...new Set(['UTC', local, ...zones])];
}

function readMode(): Mode {
  const hash = location.hash.replace('#', '');
  return hash === 'popup' || hash === 'editor' ? hash : 'widget';
}

@Component({
  selector: 'app-root',
  imports: [Board],
  templateUrl: './app.html',
  styleUrl: './app.scss',
  host: { '(document:keydown.escape)': 'onEscape()' },
})
export class App {
  protected readonly store = inject(QuestStore);
  protected readonly mode = readMode();
  protected readonly pinned = signal(false);
  protected readonly settings = computed(() => this.store.state()?.settings);

  constructor() {
    document.body.classList.add(`mode-${this.mode}`);
    this.store.api?.onPinned((p) => this.pinned.set(p));
  }

  protected readonly weekdays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  protected readonly timeZones = listTimeZones();

  protected setReset(gameId: string, patch: Partial<ResetConfig>) {
    this.store.dispatch({ type: 'game.setReset', gameId, patch });
  }

  protected localTime(at: number) {
    return new Date(at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  }

  protected localDay(at: number) {
    return new Date(at).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' });
  }

  protected update(patch: Partial<Settings>) {
    this.store.dispatch({ type: 'settings.update', patch });
  }

  protected togglePin() {
    this.store.api?.setPinned(!this.pinned());
  }

  protected hide() {
    this.store.api?.hideWindow();
  }

  protected openEditor() {
    this.store.api?.openEditor();
  }

  protected openDataFolder() {
    this.store.api?.openDataFolder();
  }

  protected cycleOpacity() {
    const current = this.settings()?.opacity ?? 1;
    const i = OPACITY_STEPS.findIndex((o) => Math.abs(o - current) < 0.01);
    this.update({ opacity: OPACITY_STEPS[(i + 1) % OPACITY_STEPS.length] });
  }

  protected onEscape() {
    if (this.mode === 'popup') this.hide();
  }
}
