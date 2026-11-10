import { Component, inject, input } from '@angular/core';
import { Board } from './board';

/** A name that turns into a text box on double-click. */
@Component({
  selector: 'qt-name',
  host: { style: 'display: contents' },
  template: `
    @if (board.editingId() === id()) {
      <input
        class="rename"
        [value]="name()"
        maxlength="80"
        (click)="$event.stopPropagation()"
        (keydown.enter)="board.commit(id(), isTask(), $any($event.target).value)"
        (keydown.escape)="board.cancel($event)"
        (blur)="board.commit(id(), isTask(), $any($event.target).value)"
      />
    } @else {
      <span class="name" [title]="board.store.editMode() ? 'Double-click to rename' : ''" (dblclick)="startRename($event)">{{ name() }}</span>
    }
  `,
})
export class Name {
  protected readonly board = inject(Board);
  readonly id = input.required<string>();
  readonly name = input.required<string>();
  readonly isTask = input(false);

  protected startRename(e: Event) {
    if (!this.board.store.editMode()) return; // let the click toggle/collapse the row instead
    e.stopPropagation();
    this.board.edit(this.id());
  }
}
