import { CdkDrag, CdkDragDrop, CdkDragHandle, CdkDropList } from '@angular/cdk/drag-drop';
import { Component, Injector, afterNextRender, computed, inject, signal } from '@angular/core';
import { GroupList } from './group-list';
import { Name } from './name';
import { QuestStore } from './quest-store';
import { Group, NodeKind, characterProgress, dropIndex, gameProgress, isDone } from './model';

/** The whole tree: games → (shared groups, characters → groups) → tasks. */
@Component({
  selector: 'qt-board',
  imports: [CdkDropList, CdkDrag, CdkDragHandle, GroupList, Name],
  templateUrl: './board.html',
  host: {
    '(focusin)': 'onFocus($event, true)',
    '(focusout)': 'onFocus($event, false)',
  },
})
export class Board {
  readonly store = inject(QuestStore);
  private readonly injector = inject(Injector);

  /** id of the game/character/group/task whose name is being edited */
  readonly editingId = signal<string | null>(null);

  protected readonly gameProgress = gameProgress;
  protected readonly characterProgress = characterProgress;

  private readonly games = computed(() => this.store.state()?.games ?? []);
  private readonly owners = computed(() => this.games().flatMap((g) => [g, ...g.characters]));

  /** Every group list is connected so groups can move between characters. */
  readonly groupListIds = computed(() => this.owners().map((o) => `groups-${o.id}`));
  readonly taskListIds = computed(() => this.owners().flatMap((o) => o.groups.map((g) => `tasks-${g.id}`)));

  visibleTasks(group: Group) {
    return this.store.state()?.settings.hideCompleted ? group.tasks.filter((t) => !isDone(t)) : group.tasks;
  }

  // `any`: each drop list carries a different data type (string id, or null for the root games list).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  drop<T extends { id: string }>(e: CdkDragDrop<any>, kind: NodeKind, full: T[], visible: T[]) {
    const id = e.item.data as string;
    const sameList = e.previousContainer === e.container;
    if (sameList && e.previousIndex === e.currentIndex) return;
    const index = dropIndex(full, visible, id, e.currentIndex);
    this.store.dispatch({ type: 'node.move', kind, id, toParentId: e.container.data, index });
  }

  protected collapse(id: string) {
    this.store.dispatch({ type: 'node.toggleCollapse', id });
  }

  deleteNode(id: string, name: string, what: string) {
    if (confirm(`Delete ${what} "${name}" and everything in it?`)) this.store.dispatch({ type: 'node.delete', id });
  }

  async addGroup(parentId: string) {
    this.edit(await this.store.dispatch({ type: 'group.add', parentId }));
  }

  protected async addCharacter(gameId: string) {
    this.edit(await this.store.dispatch({ type: 'character.add', gameId }));
  }

  protected async duplicateCharacter(characterId: string) {
    this.edit(await this.store.dispatch({ type: 'character.duplicate', characterId }));
  }

  protected async addGame() {
    this.edit(await this.store.dispatch({ type: 'game.add' }));
  }

  // ---- inline rename ----

  edit(id: string | null) {
    this.editingId.set(id);
    if (id)
      afterNextRender(() => document.querySelector<HTMLInputElement>('input.rename')?.select(), {
        injector: this.injector,
      });
  }

  commit(id: string, isTask: boolean, value: string) {
    if (this.editingId() !== id) return; // already committed/cancelled
    this.editingId.set(null);
    if (isTask) this.store.dispatch({ type: 'task.rename', taskId: id, name: value });
    else this.store.dispatch({ type: 'node.rename', id, name: value });
  }

  cancel(e: Event) {
    e.stopPropagation(); // don't let Esc also close the popup
    this.editingId.set(null);
  }

  /** Tell the main process while a text field has focus so the popup stays open. */
  protected onFocus(e: FocusEvent, focused: boolean) {
    if ((e.target as HTMLElement).tagName === 'INPUT' && (e.target as HTMLInputElement).type !== 'checkbox')
      this.store.api?.setEditing(focused);
  }
}
