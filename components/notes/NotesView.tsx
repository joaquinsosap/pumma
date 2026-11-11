"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useTransition,
  useState,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
} from "react";
import { useAutosaveDraft } from "@/lib/use-autosave-draft";
import { useSyncedDraft } from "@/lib/use-synced-draft";
import { trySave } from "@/lib/try-save";
import { useIsDesktop } from "@/lib/use-media-query";
import { shortDate } from "@/lib/date";
import {
  setReversedIn,
  sortNotes,
  NOTE_SORTS,
  type NoteSort,
} from "@/lib/collection-sort";
import { SortMenu } from "@/components/ui/sort-menu";
import { updateSettingsAction } from "@/lib/actions/settings";
import { ChevronLeft, ChevronRight, Star } from "@/components/icons";
import type { Note, Tag } from "@/lib/schemas";
import { tagBg } from "@/lib/parse";
import {
  updateNoteAction,
  toggleNotePin,
  deleteNoteAction,
  convertNoteToTask,
  setNoteColor,
} from "@/lib/actions/notes";
import { NOTE_COLORS, noteColorName } from "@/lib/note-color";
import { ColorSwatch } from "@/components/ui/color-swatch";
import { Topbar } from "@/components/shell/Topbar";
import { toast } from "sonner";
import { DeleteButton } from "@/components/ui/delete-button";
import { EditableTitle } from "@/components/ui/editable-title";
import { cn } from "@/lib/utils";
import { hrefWithLife, type LifeView } from "@/lib/life-area";
import { isLifeTag } from "@/lib/life-area-sync";
import { noteHref } from "@/lib/note-href";
import { notePreview } from "@/lib/note-preview";
import { Taggable } from "@/components/tags/TagMenuProvider";
import { paint } from "@/lib/themes";

type Props = {
  notes: Note[];
  tags: Tag[];
  selectedId: string | null;
  stats: { dayPct: number; habitsLabel: string; topStreak: number };
  lifeView?: LifeView;
  birthDate?: string | null;
  lifeSpanYears?: number;
  noteSort?: NoteSort;
  sortReversed?: string[];
};

function NotePinButton({
  pinned,
  onToggle,
  className,
}: {
  pinned: boolean;
  onToggle: () => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onToggle();
      }}
      className={cn(
        "shrink-0 rounded-md p-1 transition-colors hover:bg-hover",
        pinned ? "text-amber-500" : "text-faint2 hover:text-faint",
        className,
      )}
      title={pinned ? "Remove from favorites" : "Add to favorites"}
      aria-label={pinned ? "Unfavorite note" : "Favorite note"}
    >
      <Star
        className="h-[18px] w-[18px]"
        strokeWidth={2}
        fill={pinned ? "currentColor" : "none"}
      />
    </button>
  );
}

/** Where this device remembers that the list of notes is folded away. */
const FOLDED_KEY = "pumma:notes-list-folded";

/** A card is as tall as its note: with nothing to say beyond the title, there is no text block. */
function NoteCardText({ note }: { note: Note }) {
  const preview = notePreview(note.title, note.body);
  if (!preview) return null;
  return (
    <div className="mt-1 line-clamp-3 text-xs leading-snug text-muted">
      {preview}
    </div>
  );
}

export function NotesView({
  notes,
  tags,
  selectedId,
  stats,
  lifeView = "both",
  birthDate = null,
  lifeSpanYears,
  noteSort = "edited",
  sortReversed: sortReversedSetting = [],
}: Props) {
  const router = useRouter();
  const [sort, setSortState] = useState<NoteSort>(noteSort);
  useEffect(() => setSortState(noteSort), [noteSort]);
  const [reversed, setReversed] = useState(sortReversedSetting.includes("note"));
  useEffect(
    () => setReversed(sortReversedSetting.includes("note")),
    [sortReversedSetting],
  );
  const changeReversed = (next: boolean) => {
    setReversed(next);
    void updateSettingsAction({
      sortReversed: setReversedIn(sortReversedSetting, "note", next),
    });
  };
  const changeSort = (next: NoteSort) => {
    setSortState(next);
    setReversed(false);
    void updateSettingsAction({
      noteSort: next,
      sortReversed: setReversedIn(sortReversedSetting, "note", false),
    });
  };
  const [, startTransition] = useTransition();
  const isDesktop = useIsDesktop();

  // The list folded to a strip. Kept on this device, read once the page is in but before it is painted, so nothing jumps.
  const [folded, setFolded] = useState(false);
  // Folding slides only after the remembered state is on screen, or every load would open with the list sliding shut.
  const [moves, setMoves] = useState(false);
  useLayoutEffect(() => {
    try {
      setFolded(window.localStorage.getItem(FOLDED_KEY) === "1");
    } catch {
      // No storage (private mode): the list simply starts open.
    }
    const frame = requestAnimationFrame(() => setMoves(true));
    return () => cancelAnimationFrame(frame);
  }, []);
  const changeFolded = (next: boolean) => {
    setFolded(next);
    try {
      if (next) window.localStorage.setItem(FOLDED_KEY, "1");
      else window.localStorage.removeItem(FOLDED_KEY);
    } catch {
      // Not remembered, still folded for this visit.
    }
  };

  // Which note the editor is showing. Held here rather than read straight off
  // the route, so that picking one on a desktop is a click instead of a page
  // load. See the list item's onClick for why.
  const [openId, setOpenId] = useState<string | null>(selectedId);
  useEffect(() => setOpenId(selectedId), [selectedId]);

  // A star answers the click: the pick shows at once and the server's value takes over when it changes.
  const [pins, setPins] = useSyncedDraft<Record<string, boolean>>(
    Object.fromEntries(notes.map((n) => [n.id, n.pinned])),
    "notes",
  );
  const sorted = useMemo(
    () =>
      sortNotes(
        notes.map((n) =>
          (pins[n.id] ?? n.pinned) === n.pinned
            ? n
            : { ...n, pinned: pins[n.id] },
        ),
        sort,
        reversed,
      ),
    [notes, pins, sort, reversed],
  );

  const selected = sorted.find((n) => n.id === openId) ?? sorted[0] ?? null;
  // With no notes there is nothing to fold to: the list shows, so its count and sort stay in reach.
  const showFolded = folded && sorted.length > 0;
  // Phone master-detail: the list, or the editor with a back link, never both.
  // Wider screens show both side by side.
  const explicit = Boolean(openId && sorted.some((n) => n.id === openId));
  const tagMap = new Map(tags.map((t) => [t.id, t]));

  // Every way of picking a note keeps the address in step: ?note= drives the selection, so a stale one would snap the editor back on the next save.
  const pickNote = (id: string) => {
    setOpenId(id);
    window.history.replaceState(null, "", hrefWithLife(noteHref(id), lifeView));
  };

  const openNote = (e: React.MouseEvent, id: string) => {
    // A phone genuinely changes page here: the list and the editor are never
    // on screen together, so the back button has to mean something. On a
    // desktop both panes are already there, and all a navigation buys is a
    // server round trip and a flash of skeleton over content that never
    // changed. Modified clicks are left alone so "open in new tab" still works.
    if (!isDesktop || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    // replaceState rather than push: the address stays copyable and reloadable
    // without burying wherever you came from under a note-sized history entry
    // for every note you glanced at.
    pickNote(id);
  };

  const togglePin = (noteId: string, pinned: boolean) => {
    setPins((p) => ({ ...p, [noteId]: pinned }));
    startTransition(async () => {
      const res = await trySave(
        () => toggleNotePin(noteId, pinned),
        () => setPins((p) => ({ ...p, [noteId]: !pinned })),
      );
      if (res) router.refresh();
    });
  };

  return (
    <>
      <Topbar
        title="Notes"
        dayPct={stats.dayPct}
        habitsLabel={stats.habitsLabel}
        topStreak={stats.topStreak}
        birthDate={birthDate}
        lifeSpanYears={lifeSpanYears}
      />
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-hidden pb-6 md:flex-row md:gap-[18px]">
        {/* The list, and folded, a strip of one tile per note. On a wide screen the column's width is what folds, so the open note grows as the list goes. */}
        <div
          className={cn(
            "relative flex min-h-0 shrink-0 flex-col md:overflow-hidden",
            moves && "md:transition-[width] md:duration-300 md:ease-out",
            showFolded ? "md:w-11" : "md:w-[260px] lg:w-[300px]",
            explicit ? "max-md:hidden" : "max-md:min-h-0 max-md:flex-1",
          )}
        >
          <div
            className={cn(
              "absolute inset-y-0 left-0 hidden w-11 flex-col items-center md:flex",
              moves && "transition-[opacity,visibility] duration-200",
              showFolded ? "visible opacity-100" : "invisible opacity-0",
            )}
          >
            {/* Same height as the list's own top row, so the arrow only moves sideways. */}
            <div className="mb-2 flex h-8 shrink-0 items-center">
              <button
                type="button"
                onClick={() => changeFolded(false)}
                title="Show the list"
                aria-label="Show the list of notes"
                className="flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-lg border border-border bg-surface"
              >
                <ChevronRight className="h-4 w-4 text-muted" />
              </button>
            </div>
            <div className="flex min-h-0 w-full flex-1 flex-col items-center gap-1.5 overflow-y-auto pb-2 pt-1 [scrollbar-width:none]">
              {sorted.map((n) => {
                // One tag to tell notes apart by: the first that is not personal or work.
                const tag = n.tagIds
                  .map((id) => tagMap.get(id))
                  .find((t) => t && !isLifeTag(t.name));
                return (
                <div
                  key={n.id}
                  className="flex w-full flex-col items-center gap-0.5"
                >
                <button
                  type="button"
                  onClick={() => pickNote(n.id)}
                  title={n.title}
                  aria-label={n.title}
                  aria-current={selected?.id === n.id ? "true" : undefined}
                  className={cn(
                    "relative flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-[7px] border text-[11px] font-bold uppercase",
                    // The open note's tile is solid. The theme redraws a button naming a border or surface colour, so its fill is inline.
                    selected?.id === n.id
                      ? "border-transparent text-background"
                      : "border-border bg-surface",
                  )}
                  style={
                    selected?.id === n.id
                      ? { background: "var(--ink)" }
                      : undefined
                  }
                >
                  {Array.from(n.title.trim())[0] ?? "·"}
                  {/* The note's colour as a dot: a colour on the tile itself is redrawn by the theme. */}
                  {n.color && (
                    <span
                      aria-hidden
                      className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full ring-2 ring-background"
                      style={{ background: paint(n.color) }}
                    />
                  )}
                </button>
                {tag && (
                  <span
                    title={tag.name}
                    className="max-w-full truncate px-0.5 font-mono text-[8px] leading-none"
                    style={{ color: paint(tag.color) }}
                  >
                    {tag.name}
                  </span>
                )}
                </div>
                );
              })}
            </div>
          </div>
          <div
            className={cn(
              // Its own fixed width on a wide screen, so the cards do not reflow while the column narrows over them.
              "flex min-h-0 flex-1 flex-col md:w-[260px] lg:w-[300px]",
              moves && "md:transition-[opacity,visibility] md:duration-200",
              showFolded && "md:invisible md:opacity-0",
            )}
          >
          <div className="mb-2 flex h-8 shrink-0 items-center justify-between">
            <span className="font-mono text-[10px] uppercase tracking-widest text-faint2">
              {sorted.length} {sorted.length === 1 ? "note" : "notes"}
            </span>
            <div className="flex items-center gap-1.5">
              <SortMenu
                options={NOTE_SORTS}
                value={sort}
                onChange={changeSort}
                reversed={reversed}
                onReversedChange={changeReversed}
              />
              <button
                type="button"
                onClick={() => changeFolded(true)}
                title="Fold the list away"
                aria-label="Fold the list of notes away"
                className="hidden h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-lg border border-border bg-surface md:flex"
              >
                <ChevronLeft className="h-4 w-4 text-muted" />
              </button>
            </div>
          </div>
          <div className="flex flex-1 flex-col gap-2 overflow-y-auto max-lg:pb-24">
            {sorted.map((n) => (
              <Taggable
                key={n.id}
                entity="note"
                id={n.id}
                tagIds={n.tagIds}
                lifeArea={n.lifeArea}
                // No multi-select here, so a right-click simply opens the
                // note it lands on. Otherwise the menu would be about a note
                // while a different one sat highlighted beside it.
                onContextSelect={() => pickNote(n.id)}
                className={cn(
                  "flex items-start gap-1 rounded-[10px] border p-3 hover:bg-hover",
                  // The theme's hover fill beats an inline one, so a coloured card that is open leaves it out.
                  selected?.id === n.id
                    ? cn("border-faint2", !n.color && "bg-hover")
                    : "border-border",
                )}
                // A picked colour tints the card and its edge, a little stronger on the open note.
                style={
                  n.color
                    ? {
                        background: paint(
                          n.color,
                          selected?.id === n.id ? 0.18 : 0.09,
                        ),
                        borderColor: paint(n.color, 0.5),
                      }
                    : undefined
                }
              >
                <Link
                  href={hrefWithLife(noteHref(n.id), lifeView)}
                  className="min-w-0 flex-1"
                  onClick={(e) => openNote(e, n.id)}
                >
                  <div className="flex items-center gap-1.5">
                    <span className="flex-1 truncate text-[13.5px] font-bold">
                      {n.title}
                    </span>
                  </div>
                  <NoteCardText note={n} />
                  <div className="mt-1.5 flex items-center gap-1.5">
                    {n.tagIds.map((id) => {
                      const tg = tagMap.get(id);
                      if (!tg) return null;
                      return (
                        <span
                          key={id}
                          className="rounded px-1.5 py-px font-mono text-[9px]"
                          style={{
                            color: paint(tg.color),
                            background: tagBg(tg.color),
                          }}
                        >
                          {tg.name}
                        </span>
                      );
                    })}
                    <span className="ml-auto font-mono text-[9px] text-faint2">
                      {n.updatedAt.slice(5)}
                    </span>
                  </div>
                </Link>
                <NotePinButton
                  pinned={n.pinned}
                  onToggle={() => togglePin(n.id, !n.pinned)}
                />
              </Taggable>
            ))}
          </div>
          </div>
        </div>
        {selected && (
          <div
            key={selected.id}
            className={cn(
              "animate-pumma-swap flex min-w-0 flex-1 flex-col",
              !explicit && "max-md:hidden",
            )}
          >
            {explicit && (
              <Link
                href={hrefWithLife("/notes", lifeView)}
                className="mb-2 inline-flex items-center gap-1 self-start rounded-lg border border-border bg-surface px-2.5 py-1 text-[12px] font-semibold text-muted md:hidden"
              >
                ← All notes
              </Link>
            )}
            <NoteEditor
              key={selected.id}
              note={selected}
              onRefresh={() => router.refresh()}
              onTogglePin={(pinned) => togglePin(selected.id, pinned)}
            />
          </div>
        )}
      </div>
    </>
  );
}

function NoteEditor({
  note,
  onRefresh,
  onTogglePin,
}: {
  note: Note;
  /** Re-read from the server. For changes that alter the list, not the text. */
  onRefresh: () => void;
  onTogglePin: (pinned: boolean) => void;
}) {
  const [, startTransition] = useTransition();

  // The editor advertises "autosaves", so it must actually survive closing the
  // note or switching to another one mid-sentence, not just blur.
  const [title, setTitle, flushTitle, cancelTitle] = useAutosaveDraft(
    note.title,
    note.id,
    useCallback(
      (id: string, value: string) => updateNoteAction(id, "title", value),
      [],
    ),
    { required: true },
  );
  const [body, setBody, flushBody] = useAutosaveDraft(
    note.body,
    note.id,
    useCallback(
      (id: string, value: string) => updateNoteAction(id, "body", value),
      [],
    ),
  );

  // The colour answers the click; the server's value takes over when it changes. Picking the one it wears takes it off.
  const [color, setColor] = useSyncedDraft<string | null>(
    note.color ?? null,
    note.id,
  );
  const pickColor = (picked: string) => {
    const next = color === picked ? null : picked;
    setColor(next);
    startTransition(async () => {
      const res = await trySave(
        () => setNoteColor(note.id, next),
        () => setColor(note.color ?? null),
      );
      if (res) onRefresh();
    });
  };

  return (
    <div className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-[13px] border border-border bg-surface">
      {/* The note's colour as a band along the top: the theme pins a surface's edge, so the edge cannot carry it. */}
      {color && (
        <div
          aria-hidden
          className="h-[3px] shrink-0"
          style={{ background: paint(color) }}
        />
      )}
      <div className="flex items-center gap-2.5 border-b border-border2 px-5 py-4">
        <EditableTitle
          value={title}
          onChange={setTitle}
          onCommit={flushTitle}
          onCancel={cancelTitle}
          placeholder="Untitled"
          ariaLabel="Note title"
          wrapperClassName="flex-1"
          className="text-xl font-bold tracking-tight text-ink max-lg:text-lg"
        />
        <NotePinButton
          pinned={note.pinned}
          onToggle={() => onTogglePin(!note.pinned)}
        />
        <button
          type="button"
          className="rounded-md border border-tasks/40 bg-tasks/10 px-2.5 py-1 font-mono text-[11px] font-semibold text-tasks/80"
          onClick={() =>
            startTransition(async () => {
              const res = await trySave(() => convertNoteToTask(note.id));
              if (!res) return;
              toast.success("Converted to task");
              onRefresh();
            })
          }
        >
          → Task
        </button>
        <DeleteButton
          label="Delete note"
          onClick={() =>
            startTransition(async () => {
              const res = await trySave(() => deleteNoteAction(note.id));
              if (!res) return;
              toast.success("Note deleted");
              onRefresh();
            })
          }
        />
      </div>
      <textarea
        className="flex-1 resize-none border-none bg-transparent px-5 py-4 text-[14.5px] leading-relaxed text-ink outline-none"
        value={body}
        onChange={(e) => setBody(e.target.value)}
        onBlur={flushBody}
        placeholder="Start writing… markdown supported (# heading, **bold**, - list)"
      />
      {/* When a note was written and when it was last touched are the two
          things you want from a note you have not opened in months, and they
          were previously a 10px whisper carrying only half of it. */}
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 border-t border-border2 px-5 py-2.5 font-mono text-[11.5px] text-faint">
        <span>Created {shortDate(note.createdAt)}</span>
        <span className="text-faint2">·</span>
        <span>Edited {shortDate(note.updatedAt)}</span>
        <span
          role="group"
          aria-label="Note color"
          className="ml-auto flex items-center gap-1.5"
        >
          {NOTE_COLORS.map((c) => (
            <ColorSwatch
              key={c}
              color={c}
              picked={color === c}
              title={
                color === c
                  ? "Take the color off this note"
                  : `Make this note ${noteColorName(c)}`
              }
              onClick={() => pickColor(c)}
              className="h-5 w-5"
            />
          ))}
        </span>
        <span className="text-faint2">autosaves</span>
      </div>
    </div>
  );
}
