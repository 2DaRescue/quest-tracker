import { Component, inject, input, signal } from '@angular/core';
import { Board } from './board';
import { Name } from './name';
import { Game, Timer, formatCountdown } from './model';

const DAY_LETTERS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const SOON_MS = 15 * 60_000;

/** A game's timers: next time + countdown, alarm toggle, and an inline editor for times/days. */
@Component({
  selector: 'qt-timers',
  imports: [Name],
  template: `
    @for (t of game().timers; track t.id) {
      @let next = board.store.state()?.timerNext?.[t.id] ?? null;
      @let left = next === null ? null : next - board.store.now();
      <div class="row timer-row" [class.soon]="left !== null && left <= soonMs">
        <span class="timer-icon">⏰</span>
        <qt-name [id]="t.id" [name]="t.name" />
        <span class="spacer"></span>
        <button class="timer-when" [title]="'Goes off at ' + t.times.join(', ') + daysText(t) + ' (' + game().reset.timezone + ') — click to edit'" (click)="toggleEdit(t.id)">
          @if (next !== null) {
            <span class="at">{{ clock(next) }}</span>
            <span class="in">{{ countdown(left!) }}</span>
          }
        </button>
        <button class="bell" [class.off]="!t.notify" [title]="t.notify ? 'Alarm on — click to mute' : 'Alarm muted — click to turn on'" (click)="update(t, { notify: !t.notify })">
          {{ t.notify ? '🔔' : '🔕' }}
        </button>
        <button class="hover-btn danger" title="Delete timer" (click)="board.deleteNode(t.id, t.name, 'timer')">×</button>
      </div>

      @if (editingId() === t.id) {
        <div class="timer-edit">
          <label>
            <span>Times <small>({{ game().reset.timezone }})</small></span>
            <input
              class="times"
              [value]="t.times.join(', ')"
              placeholder="12:00, 18:00, 9pm"
              (keydown.enter)="$any($event.target).blur()"
              (change)="update(t, { times: $any($event.target).value })"
            />
          </label>
          <div class="days" title="Leave all off for every day">
            @for (d of dayLetters; track $index) {
              <button [class.on]="t.days.includes($index)" (click)="toggleDay(t, $index)">{{ d }}</button>
            }
            <small>{{ t.days.length ? '' : 'every day' }}</small>
          </div>
        </div>
      }
    }
  `,
})
export class Timers {
  protected readonly board = inject(Board);
  readonly game = input.required<Game>();

  protected readonly editingId = signal<string | null>(null);
  protected readonly dayLetters = DAY_LETTERS;
  protected readonly soonMs = SOON_MS;

  protected toggleEdit(id: string) {
    this.editingId.set(this.editingId() === id ? null : id);
  }

  protected update(t: Timer, patch: Partial<Omit<Timer, 'times'>> & { times?: string }) {
    this.board.store.dispatch({ type: 'timer.update', timerId: t.id, patch });
  }

  protected toggleDay(t: Timer, day: number) {
    const days = t.days.includes(day) ? t.days.filter((d) => d !== day) : [...t.days, day];
    this.update(t, { days });
  }

  protected daysText(t: Timer) {
    return t.days.length ? ' on ' + t.days.map((d) => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d]).join('/') : '';
  }

  /** Local clock time; adds the weekday when it's not today. */
  protected clock(at: number) {
    const d = new Date(at);
    const sameDay = d.toDateString() === new Date(this.board.store.now()).toDateString();
    return d.toLocaleString(undefined, sameDay ? { hour: 'numeric', minute: '2-digit' } : { weekday: 'short', hour: 'numeric', minute: '2-digit' });
  }

  protected countdown(ms: number) {
    return formatCountdown(ms);
  }
}
