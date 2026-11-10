import { Component, Injectable, afterNextRender, effect, inject, Injector, signal } from '@angular/core';
import { QuestStore } from './quest-store';

export interface ConfirmResult {
  ok: boolean;
  dontAsk: boolean;
}

interface ConfirmRequest {
  title: string;
  message: string;
  confirmLabel: string;
  resolve: (r: ConfirmResult) => void;
}

/** In-app replacement for window.confirm(), styled like the rest of the app. */
@Injectable({ providedIn: 'root' })
export class ConfirmService {
  readonly request = signal<ConfirmRequest | null>(null);

  ask(title: string, message: string, confirmLabel = 'Delete'): Promise<ConfirmResult> {
    this.request()?.resolve({ ok: false, dontAsk: false }); // only one dialog at a time
    return new Promise((resolve) => this.request.set({ title, message, confirmLabel, resolve }));
  }

  close(result: ConfirmResult) {
    const req = this.request();
    this.request.set(null);
    req?.resolve(result);
  }
}

@Component({
  selector: 'qt-confirm-dialog',
  template: `
    @if (confirm.request(); as req) {
      <div class="backdrop" (click)="answer(false)" (keydown.escape)="$event.stopPropagation(); answer(false)">
        <div class="dialog" role="alertdialog" aria-modal="true" [attr.aria-label]="req.title" (click)="$event.stopPropagation()">
          <h3>{{ req.title }}</h3>
          <p>{{ req.message }}</p>
          <label class="dont-ask">
            <input type="checkbox" [checked]="dontAsk()" (change)="dontAsk.set($any($event.target).checked)" />
            Don't ask again
          </label>
          <div class="actions">
            <button class="cancel" (click)="answer(false)">Cancel</button>
            <button class="danger" (click)="answer(true)">{{ req.confirmLabel }}</button>
          </div>
        </div>
      </div>
    }
  `,
  styles: `
    .backdrop {
      position: fixed;
      inset: 0;
      z-index: 1000;
      display: grid;
      place-items: center;
      padding: 16px;
      background: rgba(0, 0, 0, 0.45);
      animation: fade 0.1s ease-out;
    }
    .dialog {
      width: 100%;
      max-width: 300px;
      box-sizing: border-box;
      padding: 14px 16px 12px;
      border: 1px solid var(--line);
      border-radius: 10px;
      background: var(--bg);
      box-shadow: 0 12px 32px rgba(0, 0, 0, 0.5);
      animation: pop 0.12s ease-out;
    }
    h3 {
      margin: 0 0 6px;
      font-size: 14px;
    }
    p {
      margin: 0 0 12px;
      color: var(--muted);
      font-size: 12px;
      overflow-wrap: anywhere;
    }
    .dont-ask {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 12px;
      color: var(--muted);
      cursor: pointer;
      input {
        accent-color: var(--accent);
        margin: 0;
      }
    }
    .actions {
      display: flex;
      justify-content: flex-end;
      gap: 8px;
      margin-top: 14px;
    }
    button {
      font: inherit;
      font-size: 12px;
      padding: 5px 12px;
      border-radius: 6px;
      border: 1px solid var(--line);
      cursor: pointer;
      &:focus-visible {
        outline: 2px solid var(--accent);
        outline-offset: 1px;
      }
    }
    .cancel {
      background: var(--input);
      color: var(--text);
      &:hover {
        border-color: var(--muted);
      }
    }
    .danger {
      background: var(--danger);
      border-color: var(--danger);
      color: #1d1f27;
      font-weight: 600;
      &:hover {
        filter: brightness(1.1);
      }
    }
    @keyframes fade {
      from { opacity: 0; }
    }
    @keyframes pop {
      from { transform: scale(0.96); opacity: 0; }
    }
  `,
})
export class ConfirmDialog {
  protected readonly confirm = inject(ConfirmService);
  private readonly store = inject(QuestStore);
  private readonly injector = inject(Injector);
  protected readonly dontAsk = signal(false);

  constructor() {
    effect(() => {
      const open = !!this.confirm.request();
      // Keep the tray popup open while the dialog is up.
      this.store.api?.setEditing(open);
      if (open) {
        this.dontAsk.set(false);
        // Focus Cancel so a stray Enter never deletes anything.
        afterNextRender(() => document.querySelector<HTMLButtonElement>('qt-confirm-dialog .cancel')?.focus(), {
          injector: this.injector,
        });
      }
    });
  }

  protected answer(ok: boolean) {
    this.confirm.close({ ok, dontAsk: ok && this.dontAsk() });
  }
}
