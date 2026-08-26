"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useTransition,
  useState,
  useCallback,
  useEffect,
  useMemo,
} from "react";
import { useAutosaveDraft } from "@/lib/use-autosave-draft";
import { useIsDesktop } from "@/lib/use-media-query";
import { shortDate } from "@/lib/date";
import { sortNotes, NOTE_SORTS, type NoteSort } from "@/lib/collection-sort";
import { SortMenu } from "@/components/ui/sort-menu";
import { updateSettingsAction } from "@/lib/actions/settings";
import { Star } from "@/components/icons";
import type { Note, Tag } from "@/lib/schemas";
import { tagBg } from "@/lib/parse";
import {
  updateNoteAction,
  toggleNotePin,
  deleteNoteAction,
  convertNoteToTask,
} from "@/lib/actions/notes";
import { Topbar } from "@/components/shell/Topbar";
import { toast } from "sonner";
import { DeleteButton } from "@/components/ui/delete-button";
import { EditableTitle } from "@/components/ui/editable-title";
import { cn } from "@/lib/utils";
import { hrefWithLife, type LifeView } from "@/lib/life-area";
import { Taggable } from "@/components/tags/TagMenuProvider";

type Props = {
  notes: Note[];
  tags: Tag[];
  selectedId: string | null;
  stats: { dayPct: number; habitsLabel: string; topStreak: number };
  lifeView?: LifeView;
  birthDate?: string | null;
  lifeSpanYears?: number;
  noteSort?: NoteSort;
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

export function NotesView({
  notes,
  tags,
  selectedId,
  stats,
  lifeView = "both",
  birthDate = null,
  lifeSpanYears,
  noteSort = "edited",
}: Props) {
  const router = useRouter();
  const [sort, setSortState] = useState<NoteSort>(noteSort);
  useEffect(() => setSortState(noteSort), [noteSort]);
  const changeSort = (next: NoteSort) => {
    setSortState(next);
    void updateSettingsAction({ noteSort: next });
  };
  const [, startTransition] = useTransition();
  const isDesktop = useIsDesktop();

  // Which note the editor is showing. Held here rather than read straight off
  // the route, so that picking one on a desktop is a click instead of a page
  // load. See the list item's onClick for why.
  const [openId, setOpenId] = useState<string | null>(selectedId);
  useEffect(() => setOpenId(selectedId), [selectedId]);

  // Text saved during this session, laid over what the server last sent.
  // Every autosave used to end in router.refresh(), so half a second of typing
  // re-fetched and re-rendered the entire page to be told what we had just
  // typed. The save still happens; only the round trip is gone.
  const [edits, setEdits] = useState<Record<string, Partial<Note>>>({});
  const applyEdit = useCallback((id: string, patch: Partial<Note>) => {
    setEdits((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));
  }, []);

  // Ordered by what the server sent, and only then merged with local edits: a
  // note being typed into should not climb the list under the cursor.
  const sorted = useMemo(
    () =>
      sortNotes(notes, sort).map((n) =>
        edits[n.id] ? { ...n, ...edits[n.id] } : n,
      ),
    [notes, edits, sort],
  );

  const selected = sorted.find((n) => n.id === openId) ?? sorted[0] ?? null;
  // Phone master-detail: the list, or the editor with a back link, never both.
  // Wider screens show both side by side.
  const explicit = Boolean(openId && sorted.some((n) => n.id === openId));
  const tagMap = new Map(tags.map((t) => [t.id, t]));

  const openNote = (e: React.MouseEvent, id: string) => {
    // A phone genuinely changes page here: the list and the editor are never
    // on screen together, so the back button has to mean something. On a
    // desktop both panes are already there, and all a navigation buys is a
    // server round trip and a flash of skeleton over content that never
    // changed. Modified clicks are left alone so "open in new tab" still works.
    if (!isDesktop || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    setOpenId(id);
    // replaceState rather than push: the address stays copyable and reloadable
    // without burying wherever you came from under a note-sized history entry
    // for every note you glanced at.
    window.history.replaceState(
      null,
      "",
      hrefWithLife(`/notes/${id}`, lifeView),
    );
  };

  const togglePin = (noteId: string) => {
    startTransition(async () => {
      const res = await toggleNotePin(noteId);
      if (!res.ok) {
        toast.error(res.error ?? "Could not update favorite");
        return;
      }
      router.refresh();
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
        <div
          className={cn(
            "flex min-h-0 shrink-0 flex-col md:w-[260px] lg:w-[300px]",
            explicit ? "max-md:hidden" : "max-md:min-h-0 max-md:flex-1",
          )}
        >
          <div className="mb-2 flex shrink-0 items-center justify-between">
            <span className="font-mono text-[10px] uppercase tracking-widest text-faint2">
              {sorted.length} {sorted.length === 1 ? "note" : "notes"}
            </span>
            <SortMenu options={NOTE_SORTS} value={sort} onChange={changeSort} />
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
                onContextSelect={() => setOpenId(n.id)}
                className={cn(
                  "flex items-start gap-1 rounded-[10px] border p-3 hover:bg-hover",
                  selected?.id === n.id
                    ? "border-faint2 bg-hover"
                    : "border-border",
                )}
              >
                <Link
                  href={hrefWithLife(`/notes/${n.id}`, lifeView)}
                  className="min-w-0 flex-1"
                  onClick={(e) => openNote(e, n.id)}
                >
                  <div className="mb-1 flex items-center gap-1.5">
                    <span className="flex-1 truncate text-[13.5px] font-bold">
                      {n.title}
                    </span>
                  </div>
                  <div className="line-clamp-2 h-[34px] text-xs leading-snug text-muted">
                    {n.body || "No content yet."}
                  </div>
                  <div className="mt-1.5 flex items-center gap-1.5">
                    {n.tagIds.map((id) => {
                      const tg = tagMap.get(id);
                      if (!tg) return null;
                      return (
                        <span
                          key={id}
                          className="rounded px-1.5 py-px font-mono text-[9px]"
                          style={{
                            color: tg.color,
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
                  onToggle={() => togglePin(n.id)}
                />
              </Taggable>
            ))}
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
              onSaved={applyEdit}
              onTogglePin={() => togglePin(selected.id)}
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
  onSaved,
  onTogglePin,
}: {
  note: Note;
  /** Re-read from the server. For changes that alter the list, not the text. */
  onRefresh: () => void;
  /** Text that has just been saved, so the list can show it without a refetch. */
  onSaved: (id: string, patch: Partial<Note>) => void;
  onTogglePin: () => void;
}) {
  const [pinned, setPinned] = useState(note.pinned);
  const [, startTransition] = useTransition();

  useEffect(() => {
    setPinned(note.pinned);
  }, [note.id, note.pinned]);

  const save = useCallback(
    (field: "title" | "body", noteId: string, value: string) => {
      // Show it at once, persist in the background. Nothing here needs an
      // answer from the server: we already know what was typed. A failure is
      // the one case that does, and that is what falls back to a refetch.
      onSaved(noteId, { [field]: value });
      startTransition(async () => {
        const res = await updateNoteAction(noteId, field, value);
        if (!res.ok) {
          toast.error(res.error ?? "Could not save that");
          onRefresh();
        }
      });
    },
    [onSaved, onRefresh, startTransition],
  );

  // The editor advertises "autosaves" — so it must actually survive closing the
  // note or switching to another one mid-sentence, not just blur.
  const [title, setTitle, flushTitle] = useAutosaveDraft(
    note.title,
    note.id,
    useCallback((id, value) => save("title", id, value), [save]),
  );
  const [body, setBody, flushBody] = useAutosaveDraft(
    note.body,
    note.id,
    useCallback((id, value) => save("body", id, value), [save]),
  );

  const handleTogglePin = () => {
    setPinned((p) => !p);
    onTogglePin();
  };

  return (
    <div className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-[13px] border border-border bg-surface">
      <div className="flex items-center gap-2.5 border-b border-border2 px-5 py-4">
        <EditableTitle
          value={title}
          onChange={setTitle}
          onCommit={flushTitle}
          placeholder="Untitled"
          ariaLabel="Note title"
          wrapperClassName="flex-1"
          className="text-xl font-bold tracking-tight text-ink max-lg:text-lg"
        />
        <NotePinButton pinned={pinned} onToggle={handleTogglePin} />
        <button
          type="button"
          className="rounded-md border border-tasks/40 bg-tasks/10 px-2.5 py-1 font-mono text-[11px] font-semibold text-tasks/80"
          onClick={() =>
            startTransition(async () => {
              await convertNoteToTask(note.id);
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
              await deleteNoteAction(note.id);
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
        <span className="ml-auto text-faint2">autosaves</span>
      </div>
    </div>
  );
}
