"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
  useMemo,
} from "react";
import { useRouter } from "next/navigation";
import {
  Check,
  CheckSquare,
  ListChecks,
  Minus,
  Plus,
  Square,
  Trash2,
} from "@/components/icons";
import type { Tag, Task, Note } from "@/lib/schemas";
import type { EntityLifeArea } from "@/lib/types";
import {
  bulkToggleEntityTag,
  toggleEntityTag,
  type TaggableEntity,
} from "@/lib/actions/tags";
import {
  bulkUpdateTasks,
  deleteTaskAction,
  undoDeleteTask,
} from "@/lib/actions/tasks";
import { deleteNoteAction } from "@/lib/actions/notes";
import { addTagAction } from "@/lib/actions/settings";
import { addDays, iso } from "@/lib/date";
import { tagsByUsage } from "@/lib/metrics";
import { isLifeTag, SPECIAL_LIFE_TAGS } from "@/lib/life-area-sync";
import { toast } from "sonner";
import { isTutorialActive } from "@/lib/tutorial-lock";
import { cn } from "@/lib/utils";
import { withSingleProjectTag, projectIdFromTags } from "@/lib/project-tags";

/**
 * Multi-select, offered by whoever opened the menu. On a phone this menu IS
 * the long-press menu, so these two items are how selection works without a
 * keyboard: "Select" is ctrl-click, "Select through here" is shift-click.
 */
export type MenuSelection = {
  selected: boolean;
  /** True when something is already selected, so a range has an anchor. */
  active: boolean;
  /**
   * Every id currently selected.
   *
   * What a bulk action in this menu applies to — but only when the row you
   * right-clicked is one of them. Right-clicking OUTSIDE the selection is a
   * question about that row, not about the selection, and quietly retargeting
   * a "set to high" at four other tasks would be the worst kind of surprise.
   */
  ids: string[];
  onToggle: () => void;
  onThrough: () => void;
};

/** What a bulk row in this menu will act on, and how to say so. */
const PRIORITIES: { value: "low" | "med" | "high"; label: string; ink: string }[] =
  [
    { value: "low", label: "Low", ink: "var(--prio-low)" },
    { value: "med", label: "Mid", ink: "var(--prio-med)" },
    { value: "high", label: "High", ink: "var(--prio-high)" },
  ];

type TagTarget = {
  entity: TaggableEntity;
  id: string;
  tagIds: string[];
  lifeArea: EntityLifeArea;
  x: number;
  y: number;
  selection?: MenuSelection;
};

type TagMenuContextValue = {
  /**
   * The row the open menu points at, or null.
   *
   * Rows read this to mark themselves while the menu is up. Without it a
   * right-click on an unselected row in a list of forty gives no clue which
   * one the menu is about to act on.
   */
  activeId: string | null;
  open: (target: Omit<TagTarget, "x" | "y"> & { x: number; y: number }) => void;
  /** Dismiss it — used when the thing it points at is about to move away. */
  close: () => void;
  /**
   * Tell the menu a drag is in flight. On a phone a long press both opens this
   * menu and arms a drag, so without this the menu ends up hovering over the
   * board pointing at a card that has since moved somewhere else.
   */
  setDragActive: (active: boolean) => void;
};

const TagMenuContext = createContext<TagMenuContextValue | null>(null);

export function useTagMenu() {
  const ctx = useContext(TagMenuContext);
  if (!ctx) {
    throw new Error("useTagMenu must be used within TagMenuProvider");
  }
  return ctx;
}

export function TagMenuProvider({
  tags,
  tasks,
  notes,
  children,
}: {
  tags: Tag[];
  tasks: Task[];
  notes: Note[];
  children: ReactNode;
}) {
  const router = useRouter();
  const menuRef = useRef<HTMLDivElement>(null);
  const dirtyRef = useRef(false);
  const [menu, setMenu] = useState<TagTarget | null>(null);
  const [menuTags, setMenuTags] = useState<Tag[]>([]);
  const [tagIds, setTagIds] = useState<string[]>([]);
  const [adding, setAdding] = useState(false);
  const [newTag, setNewTag] = useState("");
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (menu) {
      setTagIds(menu.tagIds);
    }
  }, [menu]);

  const dragActiveRef = useRef(false);

  const close = useCallback(() => {
    setMenu(null);
    setMenuTags([]);
    setAdding(false);
    setNewTag("");
    if (dirtyRef.current) {
      dirtyRef.current = false;
      router.refresh();
    }
  }, [router]);

  useEffect(() => {
    if (!menu) return;
    const onKey = (e: KeyboardEvent) => {
      if (isTutorialActive()) return;
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menu, close]);

  const setDragActive = useCallback(
    (active: boolean) => {
      dragActiveRef.current = active;
      // The press that armed the drag may already have opened the menu.
      if (active) close();
    },
    [close],
  );

  // A drag cannot outlive the pointer being down. dnd-kit normally tells us
  // when one ends, but not if its DndContext unmounts mid-drag (a route change,
  // a regrouped list) — and a flag left stuck at true silently swallows every
  // context menu in the app from then on. Releasing the pointer clears it
  // whatever happened, which still leaves the flag set for the whole of a
  // touch long-press: that press is exactly what it's there to suppress.
  useEffect(() => {
    const release = () => {
      dragActiveRef.current = false;
    };
    window.addEventListener("pointerup", release);
    window.addEventListener("pointercancel", release);
    return () => {
      window.removeEventListener("pointerup", release);
      window.removeEventListener("pointercancel", release);
    };
  }, []);

  const open = useCallback(
    (target: TagTarget) => {
      // A long press that turned into a drag isn't a request for the menu.
      if (dragActiveRef.current) return;
      // Drop whatever the press already selected. `select-none` stops a
      // selection STARTING on these rows, but a press that began a fraction
      // outside one, or on a child that re-enables selection, can still leave
      // a live range behind — and it survives the menu opening on top of it.
      window.getSelection?.()?.removeAllRanges();
      dirtyRef.current = false;
      setMenu(target);
      setTagIds(target.tagIds);
      setMenuTags(tagsByUsage(tags, tasks, notes));
      setAdding(false);
      setNewTag("");
    },
    [tags, tasks, notes],
  );

  /**
   * Tagging across a selection.
   *
   * The bulk rows above (priority, due) always respected the selection; the
   * tag rows did not, because they called the single-target action with
   * `menu.id` and never looked at it. Right-clicking four selected tasks and
   * picking a tag quietly tagged one.
   *
   * Tri-state, because a selection is rarely uniform: the tick shows only
   * when EVERY selected row already carries the tag. Clicking when some do
   * adds it to the rest (the useful reading of a half-filled box), and only
   * a full house removes it.
   */
  const selectionIds =
    menu?.selection?.selected && menu.selection.ids.length > 1
      ? menu.selection.ids
      : null;

  const selectionTagState = (tagId: string): "all" | "some" | "none" => {
    if (!selectionIds) return tagIds.includes(tagId) ? "all" : "none";
    const rows = selectionIds
      .map((id) => tasks.find((t) => t.id === id))
      .filter((t): t is Task => Boolean(t));
    if (!rows.length) return "none";
    const withTag = rows.filter((t) => t.tagIds.includes(tagId)).length;
    if (withTag === 0) return "none";
    return withTag === rows.length ? "all" : "some";
  };

  const toggleAcrossSelection = async (tagId: string) => {
    if (!menu || !selectionIds || pending) return;
    const apply = selectionTagState(tagId) !== "all";
    setPending(true);
    const res = await bulkToggleEntityTag({
      entity: menu.entity,
      ids: selectionIds,
      tagId,
      apply,
    });
    setPending(false);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    const { changed, failed, error } = res.data ?? { changed: 0, failed: 0 };
    dirtyRef.current = true;
    const name = tags.find((t) => t.id === tagId)?.name ?? "tag";
    if (failed && error) {
      toast.warning(`${changed} updated, ${failed} refused: ${error}`);
    } else if (changed) {
      toast.success(
        `${apply ? "Tagged" : "Untagged"} #${name} · ${changed} ${
          changed === 1 ? "item" : "items"
        }`,
      );
    } else {
      toast.info(`Already ${apply ? "tagged" : "untagged"}`);
    }
    // A project tag moves everything it touched, so the open menu is now
    // pointing at rows that have gone elsewhere.
    if (tags.find((t) => t.id === tagId)?.projectId) close();
    router.refresh();
  };

  const toggle = async (tagId: string) => {
    if (selectionIds) return toggleAcrossSelection(tagId);
    if (!menu || pending) return;
    setPending(true);
    const applied = !tagIds.includes(tagId);
    let nextTagIds = applied
      ? [...tagIds, tagId]
      : tagIds.filter((id) => id !== tagId);
    // The server files the task under the project this tag belongs to and
    // drops any other project's tags. Mirror it, or the ticks would show a
    // state that lasts only until the next render.
    nextTagIds = withSingleProjectTag(
      nextTagIds,
      projectIdFromTags(nextTagIds, tags),
      tags,
    );
    setTagIds(nextTagIds);
    const res = await toggleEntityTag(menu.entity, menu.id, tagId);
    setPending(false);
    if (!res.ok) {
      setTagIds(menu.tagIds);
      toast.error(res.error);
      return;
    }
    dirtyRef.current = true;

    // Picking another project's tag moves the task: its project, its life tags
    // and its other project tags all change at once. The menu was opened
    // against the old version, so keeping it up would show stale ticks against
    // a row that has already moved.
    const moved = tags.find((t) => t.id === tagId)?.projectId;
    if (moved) close();
  };

  const handleDelete = async () => {
    if (!menu || pending) return;
    setPending(true);
    const res =
      menu.entity === "task"
        ? await deleteTaskAction(menu.id)
        : await deleteNoteAction(menu.id);
    setPending(false);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    const label = menu.entity === "task" ? "Task deleted" : "Note deleted";
    // JSON, not the object: undoDeleteTask parses a string, and handing it the
    // raw snapshot made UNDO fail silently.
    const undoSnapshot =
      menu.entity === "task" && res.undo
        ? JSON.stringify(res.undo.snapshot)
        : undefined;
    close();
    toast.success(label, {
      action: undoSnapshot
        ? {
            label: "UNDO",
            onClick: async () => {
              await undoDeleteTask(undoSnapshot);
              router.refresh();
            },
          }
        : undefined,
    });
    router.refresh();
  };

  const handleAddTag = async () => {
    const name = newTag.trim().toLowerCase();
    if (!name || !menu || pending) return;
    setPending(true);
    const existing = tags.find((t) => t.name === name);
    if (existing) {
      if (!tagIds.includes(existing.id)) {
        await toggleEntityTag(menu.entity, menu.id, existing.id);
        const nextTagIds = [...tagIds, existing.id];
        setTagIds(nextTagIds);
      }
      setPending(false);
      setAdding(false);
      setNewTag("");
      dirtyRef.current = true;
      return;
    }
    const res = await addTagAction(name);
    if (!res.ok) {
      toast.error(res.error);
      setPending(false);
      return;
    }
    await toggleEntityTag(menu.entity, menu.id, res.data!.id);
    const nextTagIds = [...tagIds, res.data!.id];
    setTagIds(nextTagIds);
    setMenuTags((prev) => [...prev, res.data!]);
    setPending(false);
    setAdding(false);
    setNewTag("");
    toast.success(`Tagged with ${name}`);
    dirtyRef.current = true;
  };

  // Life tags are the personal/work split, not labels — they get their own
  // outlined box so they read as a different kind of thing, while still being
  // tags you toggle rather than a separate control.
  const lifeTags = menu
    ? SPECIAL_LIFE_TAGS.map((name) =>
        menuTags.find((t) => t.name.toLowerCase() === name),
      ).filter((t): t is NonNullable<typeof t> => Boolean(t))
    : [];
  const ranked = menu ? menuTags.filter((t) => !isLifeTag(t.name)) : [];

  const pos = menu
    ? (() => {
        const w = 200;
        const h = Math.min(
          400,
          56 +
            ranked.length * 32 +
            lifeTags.length * 30 +
            (adding ? 44 : 28) +
            (menu.selection ? 66 : 0) +
            72,
        );
        const x = Math.min(menu.x, window.innerWidth - w - 8);
        // Prefer opening at the point you pressed. When the menu will not fit
        // below it, put it ABOVE the point rather than sliding it down the
        // screen: pressing something near the bottom used to throw the menu
        // to a fixed spot far from the row it belongs to, which reads as the
        // menu having nothing to do with what you pressed.
        const below = menu.y;
        const y =
          below + h + 8 <= window.innerHeight
            ? below
            : Math.max(8, menu.y - h - 8);
        return { left: Math.max(8, x), top: Math.max(8, y) };
      })()
    : null;

  /**
   * What the bulk rows act on.
   *
   * The selection only counts when the right-clicked row is IN it. Outside it,
   * the menu is a question about that one row.
   */
  const bulkTargets =
    menu?.selection?.selected && menu.selection.ids.length
      ? menu.selection.ids
      : menu
        ? [menu.id]
        : [];

  const applyBulk = (
    patch: { priority?: "low" | "med" | "high"; due?: string | null },
    label: string,
  ) => {
    if (!menu || bulkTargets.length === 0) return;
    const ids = bulkTargets;
    setPending(true);
    close();
    void (async () => {
      const res = await bulkUpdateTasks({ ids, ...patch });
      setPending(false);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(ids.length > 1 ? `${label} · ${ids.length} tasks` : label);
      router.refresh();
    })();
  };

  const tagMenuValue = useMemo(
    () => ({ activeId: menu?.id ?? null, open, close, setDragActive }),
    [menu?.id, open, close, setDragActive],
  );

  return (
    <TagMenuContext.Provider value={tagMenuValue}>
      {children}
      {menu && pos && (
        <>
          {/* The backdrop and the menu both refuse selection.
              A long press is the browser's own "select a word" gesture, so by
              the time our timer fires a selection may already be forming. It
              then extends across whatever the finger passes over, which is
              this menu, and picking an item turns into dragging over its
              text. The row was already select-none; these two were not. */}
          <div
            className="fixed inset-0 z-[100] select-none [-webkit-touch-callout:none]"
            onClick={close}
            onContextMenu={(e) => {
              e.preventDefault();
              close();
            }}
          />
          <div
            ref={menuRef}
            className="pumma-floating fixed z-[101] w-[200px] select-none overflow-hidden rounded-lg border border-border bg-surface p-1 shadow-lg [-webkit-touch-callout:none]"
            style={{ left: pos.left, top: pos.top }}
            onContextMenu={(e) => e.preventDefault()}
          >
            {/* Priority and due, at the top, because they are the two things
                anybody opens this menu to change and they were both a trip to
                the detail panel away.

                They act on the SELECTION when the row you right-clicked is
                part of it, and on that row alone when it is not. Silently
                retargeting a "set to high" at four other tasks because
                something was selected elsewhere would be the worst kind of
                surprise, so the count is spelled out above them. */}
            {menu.entity === "task" && (
              <div className="mb-1 border-b border-border2 pb-1">
                {bulkTargets.length > 1 && (
                  <p className="m-0 px-2 pb-1 pt-0.5 font-mono text-[10px] uppercase tracking-widest text-faint2">
                    {bulkTargets.length} selected
                  </p>
                )}
                <div className="flex items-center gap-1 px-1 pb-1">
                  {PRIORITIES.map((p) => (
                    <button
                      key={p.value}
                      type="button"
                      disabled={pending}
                      onClick={() => applyBulk({ priority: p.value }, p.label)}
                      className="flex flex-1 items-center justify-center gap-1 rounded-md border border-border px-1.5 py-1 font-mono text-[10.5px] font-bold uppercase transition-colors hover:bg-hover disabled:opacity-50"
                      style={{ color: p.ink }}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>
                <div className="flex items-center gap-1 px-1">
                  {[
                    { label: "Today", due: iso() },
                    { label: "Tomorrow", due: iso(addDays(1)) },
                    { label: "Clear", due: null },
                  ].map((d) => (
                    <button
                      key={d.label}
                      type="button"
                      disabled={pending}
                      onClick={() => applyBulk({ due: d.due }, d.label)}
                      className="flex flex-1 items-center justify-center rounded-md border border-border px-1.5 py-1 font-mono text-[10.5px] text-muted transition-colors hover:bg-hover hover:text-ink disabled:opacity-50"
                    >
                      {d.label}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {menu.selection && (
              <div className="mb-1 border-b border-border2 pb-1">
                <button
                  type="button"
                  onClick={() => {
                    menu.selection!.onToggle();
                    close();
                  }}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12px] text-ink transition-colors hover:bg-hover"
                >
                  {menu.selection.selected ? (
                    <CheckSquare className="h-3.5 w-3.5 text-primary" />
                  ) : (
                    <Square className="h-3.5 w-3.5 text-faint" />
                  )}
                  {menu.selection.selected ? "Deselect" : "Select"}
                </button>
                <button
                  type="button"
                  disabled={!menu.selection.active}
                  onClick={() => {
                    menu.selection!.onThrough();
                    close();
                  }}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12px] text-ink transition-colors hover:bg-hover disabled:cursor-not-allowed disabled:text-faint2 disabled:hover:bg-transparent"
                  title={
                    menu.selection.active
                      ? undefined
                      : "Select one first, then pick the far end"
                  }
                >
                  <ListChecks className="h-3.5 w-3.5 text-faint" />
                  Select through here
                </button>
              </div>
            )}
            {lifeTags.length > 0 && (
              <div className="mb-1 rounded-md border border-dashed border-border2 bg-surface2/50 p-1">
                <div className="px-1 pb-0.5 pt-0.5 font-mono text-[9px] font-medium tracking-widest text-faint2">
                  LIFE AREA
                </div>
                {lifeTags.map((tag) => {
                  const state = selectionTagState(tag.id);
                  return (
                    <button
                      key={tag.id}
                      type="button"
                      disabled={pending}
                      onClick={() => toggle(tag.id)}
                      className={cn(
                        "flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left text-[12px] transition-colors hover:bg-hover disabled:opacity-50",
                        state === "all" ? "font-semibold text-ink" : "text-muted",
                      )}
                    >
                      <span
                        className="h-2 w-2 shrink-0 rounded-full"
                        style={{ background: tag.color }}
                      />
                      <span className="min-w-0 flex-1 truncate">
                        {tag.name}
                      </span>
                      <TagMark state={state} />
                    </button>
                  );
                })}
              </div>
            )}
            <div className="px-2 py-1.5 font-mono text-[9px] font-medium tracking-widest text-faint2">
              TAG
            </div>
            <div className="max-h-[220px] overflow-y-auto [-ms-overflow-style:none] [scrollbar-width:none]">
              {ranked.length === 0 && !adding && (
                <p className="px-2 py-1.5 text-[11px] text-faint">
                  No tags yet
                </p>
              )}
              {ranked.map((tag) => {
                const state = selectionTagState(tag.id);
                return (
                  <button
                    key={tag.id}
                    type="button"
                    disabled={pending}
                    onClick={() => toggle(tag.id)}
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12px] text-ink hover:bg-hover disabled:opacity-50"
                  >
                    <span
                      className="h-2 w-2 shrink-0 rounded-full"
                      style={{ background: tag.color }}
                    />
                    <span className="min-w-0 flex-1 truncate">{tag.name}</span>
                    <TagMark state={state} />
                  </button>
                );
              })}
            </div>
            <div className="mt-1 border-t border-border2 pt-1">
              {adding ? (
                <div className="flex gap-1 px-1">
                  <input
                    autoFocus
                    value={newTag}
                    onChange={(e) => setNewTag(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void handleAddTag();
                      if (e.key === "Escape") {
                        setAdding(false);
                        setNewTag("");
                      }
                    }}
                    placeholder="new tag"
                    className="min-w-0 flex-1 rounded-md border border-border bg-surface2 px-2 py-1 font-mono text-[11px] outline-none focus:border-faint"
                  />
                  <button
                    type="button"
                    onClick={() => void handleAddTag()}
                    disabled={pending || !newTag.trim()}
                    className="rounded-md bg-ink px-2 py-1 text-[10px] font-semibold text-background disabled:opacity-40"
                  >
                    Add
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setAdding(true)}
                  className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-[11px] text-muted hover:bg-hover"
                >
                  <Plus className="h-3.5 w-3.5" />
                  New tag
                </button>
              )}
            </div>
            <div className="mt-1 border-t border-border2 pt-1">
              <button
                type="button"
                disabled={pending}
                onClick={() => void handleDelete()}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12px] text-tasks transition-colors hover:bg-tasks/10 disabled:opacity-50"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Delete {menu.entity}
              </button>
            </div>
          </div>
        </>
      )}
    </TagMenuContext.Provider>
  );
}

export function Taggable({
  entity,
  id,
  tagIds,
  lifeArea,
  className,
  style,
  children,
  onClick,
  selection,
  onContextSelect,
}: {
  entity: TaggableEntity;
  id: string;
  tagIds: string[];
  lifeArea: EntityLifeArea;
  className?: string;
  /** Inline overrides for things a utility class cannot win, such as a
   *  border-left colour competing with the border-color shorthand. */
  style?: React.CSSProperties;
  children: ReactNode;
  /** Gets the event so callers can read ctrl/shift off the click. */
  onClick?: (e: React.MouseEvent) => void;
  selection?: MenuSelection;
  /**
   * For surfaces with no multi-select, like notes.
   *
   * There, "which one is this menu about" cannot be answered with a lighter
   * shade of selected, because there is no selected. So the right-click just
   * makes it the open one, which is both the answer and what you were
   * probably about to do anyway.
   */
  onContextSelect?: () => void;
}) {
  const { open, activeId } = useTagMenu();
  // Lighter than a real selection on purpose: this is "the menu is about to
  // act on THIS one", not "this is selected". Two states that look the same
  // would be worse than no marker at all.
  const menuTarget = activeId === id;
  // A long press, spelled out, because `contextmenu` is not a gesture on a
  // phone. Android fires it; iOS mostly does not, and what happens there
  // instead is the text under your finger gets selected and the system
  // offers to copy it. That is the blue smear across half a task list, with
  // our own menu nowhere in sight.
  const press = useRef<{ timer: number; x: number; y: number } | null>(null);
  const longPressed = useRef(false);

  const cancelPress = () => {
    if (press.current) window.clearTimeout(press.current.timer);
    press.current = null;
  };

  const openAt = (x: number, y: number) => {
    onContextSelect?.();
    open({ entity, id, tagIds, lifeArea, x, y, selection });
  };

  return (
    <div
      className={cn(
        // No selecting, and no iOS callout. These rows are things you tap,
        // drag and press-and-hold; none of that wants a text cursor, and the
        // selection was competing with the gesture rather than accompanying
        // it. Inputs inside re-enable it for themselves below.
        "select-none [-webkit-touch-callout:none] [&_input]:select-text [&_textarea]:select-text",
        menuTarget && !selection?.selected && "bg-primary/[0.09]",
        className,
      )}
      style={style}
      data-task-id={entity === "task" ? id : undefined}
      onClick={(e) => {
        // The tap that ends a long press is not a tap on the row.
        if (longPressed.current) {
          longPressed.current = false;
          e.preventDefault();
          e.stopPropagation();
          return;
        }
        onClick?.(e);
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        cancelPress();
        // A real right-click carries a point. A long press synthesised into
        // `contextmenu` sometimes carries 0,0, which would pin the menu to a
        // corner — fall back to where the finger actually was.
        const x = e.clientX || press.current?.x || 0;
        const y = e.clientY || press.current?.y || 0;
        openAt(x, y);
      }}
      onTouchStart={(e) => {
        const t = e.touches[0];
        if (!t) return;
        const x = t.clientX;
        const y = t.clientY;
        press.current = {
          x,
          y,
          timer: window.setTimeout(() => {
            longPressed.current = true;
            press.current = null;
            openAt(x, y);
          }, 450),
        };
      }}
      onTouchMove={(e) => {
        const t = e.touches[0];
        if (!t || !press.current) return;
        // A press that travels is a scroll, not a hold.
        if (
          Math.abs(t.clientX - press.current.x) > 10 ||
          Math.abs(t.clientY - press.current.y) > 10
        ) {
          cancelPress();
        }
      }}
      onTouchEnd={cancelPress}
      onTouchCancel={cancelPress}
    >
      {children}
    </div>
  );
}

/**
 * All / some / none, as one glyph.
 *
 * A tick that means "at least one of these has it" is a lie you only catch
 * after untagging four rows you meant to leave alone, so the half state gets
 * its own mark: a dash, the same thing an indeterminate checkbox has always
 * used. Nothing at all for none, which keeps the common case quiet.
 */
function TagMark({ state }: { state: "all" | "some" | "none" }) {
  if (state === "none") return null;
  if (state === "some") {
    return (
      <span
        aria-label="Some selected"
        className="h-3.5 w-3.5 shrink-0 text-habits"
      >
        <Minus className="h-3.5 w-3.5" strokeWidth={3} />
      </span>
    );
  }
  return <Check className="h-3.5 w-3.5 shrink-0 text-habits" strokeWidth={2.5} />;
}
