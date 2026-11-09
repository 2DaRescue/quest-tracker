import { Component, inject, signal } from '@angular/core';
import { Board } from './board';
import { QuestStore } from './quest-store';

type Mode = 'widget' | 'popup';

const OPACITY_STEPS = [1, 0.85, 0.7, 0.55];

@Component({
  selector: 'app-root',
  imports: [Board],
  templateUrl: './app.html',
  styleUrl: './app.scss',
  host: { '(document:keydown.escape)': 'onEscape()' },
})
export class App {
  protected readonly store = inject(QuestStore);
  protected readonly mode: Mode = location.hash.replace('#', '') === 'popup' ? 'popup' : 'widget';
  protected readonly pinned = signal(false);

  constructor() {
    document.body.classList.add(`mode-${this.mode}`);
    this.store.api?.onPinned((p) => this.pinned.set(p));
  }

  protected togglePin() {
    this.store.api?.setPinned(!this.pinned());
  }

  protected hide() {
    this.store.api?.hideWindow();
  }

  protected cycleOpacity() {
    const current = this.store.state()?.settings.opacity ?? 1;
    const i = OPACITY_STEPS.findIndex((o) => Math.abs(o - current) < 0.01);
    const opacity = OPACITY_STEPS[(i + 1) % OPACITY_STEPS.length];
    this.store.dispatch({ type: 'settings.update', patch: { opacity } });
  }

  protected onEscape() {
    if (this.mode === 'popup') this.hide();
  }
}
