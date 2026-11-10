import { CdkDrag, CdkDragHandle, CdkDropList } from '@angular/cdk/drag-drop';
import { Component, inject, input, signal } from '@angular/core';
import { Board } from './board';
import { Name } from './name';
import { Cadence, Character, Game, Group, Task, TaskKind, groupProgress, isDone, taskProgress } from './model';

/** The groups belonging to one owner: a game's shared groups or a character's. */
@Component({
  selector: 'qt-group-list',
  imports: [CdkDropList, CdkDrag, CdkDragHandle, Name],
  templateUrl: './group-list.html',
})
export class GroupList {
  protected readonly board = inject(Board);
  private readonly store = this.board.store;

  readonly owner = input.required<Game | Character>();
  readonly game = input.required<Game>();

  protected readonly groupProgress = groupProgress;
  protected readonly taskProgress = taskProgress;
  protected readonly isDone = isDone;

  /** group whose "Copy to:" picker is open */
  protected readonly copyingId = signal<string | null>(null);

  protected readonly cadenceLabel: Record<Cadence, string> = { daily: 'D', weekly: 'W', none: '–' };
  protected readonly cadenceTitle: Record<Cadence, string> = {
    daily: 'Resets daily',
    weekly: 'Resets weekly',
    none: 'Manual (never resets)',
  };

  protected cycleCadence(group: Group) {
    const order: Cadence[] = ['none', 'daily', 'weekly'];
    const cadence = order[(order.indexOf(group.cadence) + 1) % order.length];
    this.store.dispatch({ type: 'group.setCadence', groupId: group.id, cadence });
  }

  protected collapse(id: string) {
    this.store.dispatch({ type: 'node.toggleCollapse', id });
  }

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

  protected resetGroup(groupId: string) {
    this.store.dispatch({ type: 'group.resetNow', groupId });
  }

  protected deleteTask(t: Task) {
    this.store.dispatch({ type: 'task.delete', taskId: t.id });
  }

  protected async addTask(groupId: string, kind: TaskKind) {
    this.board.edit(await this.store.dispatch({ type: 'task.add', groupId, kind }));
  }

  /** With no characters there's only one place to copy to, so skip the picker. */
  protected copyGroup(groupId: string) {
    if (this.game().characters.length) this.copyingId.set(this.copyingId() === groupId ? null : groupId);
    else this.duplicateGroup(groupId, this.game().id);
  }

  protected async duplicateGroup(groupId: string, targetId: string) {
    this.copyingId.set(null);
    this.board.edit(await this.store.dispatch({ type: 'group.duplicate', groupId, targetId }));
  }
}
