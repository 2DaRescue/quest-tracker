import { Component, computed, inject, signal } from '@angular/core';
import { Board } from './board';
import { QuestStore } from './quest-store';
import { Settings } from './model';

type Mode = 'widget' | 'popup' | 'editor';

const OPACITY_STEPS = [1, 0.85, 0.7, 0.55];

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
