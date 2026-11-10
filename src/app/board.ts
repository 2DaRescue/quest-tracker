import { CdkDrag, CdkDragDrop, CdkDragHandle, CdkDropList } from '@angular/cdk/drag-drop';
import { Component, Injector, afterNextRender, computed, inject, signal } from '@angular/core';
import { ConfirmService } from './confirm';
import { GroupList } from './group-list';
import { Name } from './name';
import { Timers } from './timers';
import { QuestStore } from './quest-store';
import {
  Cadence,
  Character,
  Game,
  Group,
  NodeKind,
  isSimpleCharacter,
  cadencesUsed,
  characterProgress,
  dropIndex,
  formatCountdown,
  gameProgress,
  isDone,
} from './model';

/** The whole tree: games → (shared groups, characters → groups) → tasks. */
@Component({
  selector: 'qt-board',
  imports: [CdkDropList, CdkDrag, CdkDragHandle, GroupList, Name, Timers],
  templateUrl: './board.html',
  host: {
    '(focusin)': 'onFocus($event, true)',
    '(focusout)': 'onFocus($event, false)',
  },
})
export class Board {
  readonly store = inject(QuestStore);
  private readonly confirm = inject(ConfirmService);
  private readonly injector = inject(Injector);

  /** id of the game/character/group/task whose name is being edited */
  readonly editingId = signal<string | null>(null);

  protected readonly gameProgress = gameProgress;
  protected readonly characterProgress = characterProgress;
  protected readonly cadencesUsed = cadencesUsed;

  protected countdown(at: number) {
    return formatCountdown(at - this.store.now());
  }

  /** Local display time of a reset, e.g. "Mon 9:00 AM". */
  protected when(at: number) {
    return new Date(at).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' });
  }

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

  async deleteNode(id: string, name: string, what: string) {
    if (this.store.state()?.settings.confirmDelete !== false) {
      const contents = what === 'timer' ? '' : ' and everything in it';
      const r = await this.confirm.ask(`Delete ${what}?`, `"${name}"${contents} will be removed.`);
      if (!r.ok) return;
      if (r.dontAsk) this.store.dispatch({ type: 'settings.update', patch: { confirmDelete: false } });
    }
    this.store.dispatch({ type: 'node.delete', id });
  }

  async addGroup(parentId: string) {
    this.edit(await this.store.dispatch({ type: 'group.add', parentId }));
  }

  protected async addCharacter(gameId: string) {
    this.edit(await this.store.dispatch({ type: 'character.add', gameId }));
  }

  protected readonly isSimpleCharacter = isSimpleCharacter;
  protected readonly cadenceLabel: Record<Cadence, string> = { daily: 'D', weekly: 'W', none: '–' };
  protected readonly cadenceTitle: Record<Cadence, string> = {
    daily: 'Unticks at the daily reset',
    weekly: 'Unticks at the weekly reset',
    none: 'Manual (stays ticked)',
  };

  /** With "hide completed" on, ticked-off simple characters are hidden like finished tasks. */
  protected visibleCharacters(game: Game) {
    if (!this.store.state()?.settings.hideCompleted) return game.characters;
    return game.characters.filter((c) => !(isSimpleCharacter(c) && c.done));
  }

  protected toggleCharacter(characterId: string) {
    this.store.dispatch({ type: 'character.toggle', characterId });
  }

  protected cycleCharacterCadence(ch: Character) {
    const order: Cadence[] = ['none', 'daily', 'weekly'];
    const cadence = order[(order.indexOf(ch.cadence) + 1) % order.length];
    this.store.dispatch({ type: 'character.setCadence', characterId: ch.id, cadence });
  }

  protected async duplicateCharacter(characterId: string) {
    this.edit(await this.store.dispatch({ type: 'character.duplicate', characterId }));
  }

  protected async addTimer(gameId: string) {
    this.edit(await this.store.dispatch({ type: 'timer.add', gameId }));
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
