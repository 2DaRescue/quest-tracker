import { NgTemplateOutlet } from '@angular/common';
import { Component, Injector, afterNextRender, inject, signal } from '@angular/core';
import { QuestStore } from './quest-store';
import { Task, TaskKind, gameProgress, groupProgress, taskProgress } from './model';

@Component({
  selector: 'qt-board',
  imports: [NgTemplateOutlet],
  templateUrl: './board.html',
  styleUrl: './board.scss',
  host: {
    '(focusin)': 'onFocus($event, true)',
    '(focusout)': 'onFocus($event, false)',
  },
})
export class Board {
  protected readonly store = inject(QuestStore);
  private readonly injector = inject(Injector);

  /** id of the task/group/game whose name is being edited */
  protected readonly editingId = signal<string | null>(null);

  protected readonly gameProgress = gameProgress;
  protected readonly groupProgress = groupProgress;
  protected readonly taskProgress = taskProgress;

  protected toggle(t: Task) {
    this.store.dispatch({ type: 'task.toggle', taskId: t.id });
  }

  protected adjust(t: Task, delta: 1 | -1) {
    this.store.dispatch({ type: 'task.adjust', taskId: t.id, delta });
  }

  protected setTarget(t: Task, raw: string) {
    const target = parseInt(raw, 10);
    if (target > 0) this.store.dispatch({ type: 'task.setTarget', taskId: t.id, target });
  }

  protected collapse(id: string) {
    this.store.dispatch({ type: 'node.toggleCollapse', id });
  }

  protected resetGroup(groupId: string) {
    this.store.dispatch({ type: 'group.resetNow', groupId });
  }

  protected deleteTask(t: Task) {
    this.store.dispatch({ type: 'task.delete', taskId: t.id });
  }

  protected deleteNode(id: string, name: string, what: string) {
    if (confirm(`Delete ${what} "${name}" and everything in it?`)) this.store.dispatch({ type: 'node.delete', id });
  }

  protected async addTask(groupId: string, kind: TaskKind) {
    this.edit(await this.store.dispatch({ type: 'task.add', groupId, kind }));
  }

  protected async addGroup(gameId: string) {
    this.edit(await this.store.dispatch({ type: 'group.add', gameId }));
  }

  protected async addGame() {
    this.edit(await this.store.dispatch({ type: 'game.add' }));
  }

  // ---- inline rename ----

  protected edit(id: string | null) {
    this.editingId.set(id);
    if (id)
      afterNextRender(() => document.querySelector<HTMLInputElement>('input.rename')?.select(), {
        injector: this.injector,
      });
  }

  protected commit(id: string, isTask: boolean, value: string) {
    if (this.editingId() !== id) return; // already committed/cancelled
    this.editingId.set(null);
    if (isTask) this.store.dispatch({ type: 'task.rename', taskId: id, name: value });
    else this.store.dispatch({ type: 'node.rename', id, name: value });
  }

  protected cancel(e: Event) {
    e.stopPropagation(); // don't let Esc also close the popup
    this.editingId.set(null);
  }

  /** Tell the main process while a text field has focus so the popup stays open. */
  protected onFocus(e: FocusEvent, focused: boolean) {
    if ((e.target as HTMLElement).tagName === 'INPUT' && (e.target as HTMLInputElement).type !== 'checkbox')
      this.store.api?.setEditing(focused);
  }
}
