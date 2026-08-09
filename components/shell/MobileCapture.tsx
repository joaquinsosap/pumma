"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  CalendarDays,
  Pencil,
  Plus,
  Search,
  Sparkles,
  X,
} from "@/components/icons";
import { toast } from "sonner";
import type { EntityLifeArea, OmniType } from "@/lib/types";
import type { Note, Project, Tag, Task } from "@/lib/schemas";
import { addDays, iso } from "@/lib/date";
import { parseOmni, tagBg } from "@/lib/parse";
import { getCaptureContext } from "@/lib/capture-context";
import { createFromOmni, undoCreate } from "@/lib/actions/tasks";
import { useLifeView } from "@/components/shell/LifeAreaToggle";
import { deriveLifeAreaFromTags, withLifeTags } from "@/lib/life-area-sync";
import { useAssistant } from "@/components/assistant/AssistantProvider";
import { isTutorialActive } from "@/lib/tutorial-lock";
import { sectionMetaFor } from "@/components/shell/MobileDock";
import { useTimezone } from "@/components/shell/TimeZoneProvider";
import { cn } from "@/lib/utils";
import {
  PRIORITY_COLOR,
  PRIORITY_GLYPH,
} from "@/components/tasks/PriorityChip";
import type { TaskPriority } from "@/lib/types";

const PRIORITY_OPTIONS: { value: TaskPriority; label: string }[] = [
  { value: "high", label: "High" },
  { value: "med", label: "Mid" },
  { value: "low", label: "Low" },
];

// Same single Assistant entry as the desktop omnibar: the assistant works
// out whether the text is a question or a request, so the user no longer has
// to pick Plan or Ask before typing.
type Mode = "capture" | "assistant";

const TYPES: {
  type: OmniType;
  label: string;
  color: string;
  shape: "square" | "dot" | "diamond";
}[] = [
  {
    type: "task",
    label: "Task",
    color: "oklch(0.64 0.18 25)",
    shape: "square",
  },
  { type: "habit", label: "Habit", color: "oklch(0.6 0.13 155)", shape: "dot" },
  {
    type: "goal",
    label: "Goal",
    color: "oklch(0.58 0.17 300)",
    shape: "diamond",
  },
  { type: "note", label: "Note", color: "var(--faint)", shape: "square" },
];

const LIFE_META: Record<
  EntityLifeArea,
  { label: string; border: string; bg: string; text: string } | null
> = {
  work: {
    label: "Work",
    border: "oklch(0.58 0.14 245)",
    bg: "oklch(0.58 0.14 245 / 0.14)",
    text: "oklch(0.44 0.14 245)",
  },
  personal: {
    label: "Personal",
    border: "oklch(0.58 0.17 300)",
    bg: "oklch(0.58 0.17 300 / 0.14)",
    text: "oklch(0.46 0.17 300)",
  },
  both: null,
};

type Props = {
  tags: Tag[];
  tasks: Task[];
  notes: Note[];
  projects: Project[];
  defaultType?: OmniType;
};

/**
 * Phone capture: a compact pill that opens a purpose-built full-screen
 * capture form — big input, large mode/type/due/tag controls stacked down
 * the whole screen, submit pinned at the bottom. Shares the exact same
 * server logic as the desktop OmniBox (parseOmni syntax still works).
 */
export function MobileCapture({ tags, projects, defaultType = "task" }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [life] = useLifeView();
  const assistant = useAssistant();
  const timeZone = useTimezone();

  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>("capture");
  const [type, setType] = useState<OmniType>(defaultType);
  const [text, setText] = useState("");
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);
  const [pickedDue, setPickedDue] = useState<string | null>(null);
  const [pickedPriority, setPickedPriority] = useState<TaskPriority>("med");
  const [pending, startTransition] = useTransition();
  const busy = assistant.status === "pending";

  const capture = useMemo(
    () =>
      getCaptureContext(
        pathname,
        searchParams,
        defaultType,
        projects.map((p) => ({ id: p.id, title: p.title })),
      ),
    [pathname, searchParams, defaultType, projects],
  );

  const openWith = (t: OmniType) => {
    // Tell the shell a capture is opening (the dock closes its More menu).
    window.dispatchEvent(new CustomEvent("pumma:capture-opening"));
    setType(t);
    // Opening the sheet from the Assistant page means you want the assistant,
    // same as the desktop bar switching itself over there.
    setMode(pathname === "/assistant" ? "assistant" : "capture");
    setText("");
    setSelectedTagIds([]);
    setPickedDue(null);
    setPickedPriority("med");
    setOpen(true);
  };

  useEffect(() => {
    const onCapture = (e: Event) => {
      const t = (e as CustomEvent).detail?.type as OmniType | undefined;
      openWith(t ?? capture.type);
    };
    const onKey = (e: KeyboardEvent) => {
      if (isTutorialActive()) return;
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("pumma:capture", onCapture);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pumma:capture", onCapture);
      window.removeEventListener("keydown", onKey);
    };
  }, [capture.type]);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  const isTask = type === "task";
  const parsed = parseOmni(text, tags, undefined, undefined, timeZone);

  // Preview exactly what will be stored: the view's life tags get attached on
  // create unless one was typed or picked. Every capture type carries tags —
  // habits and goals included — so the chip is true for all of them.
  const captureArea: EntityLifeArea = deriveLifeAreaFromTags(
    withLifeTags(
      [...new Set([...selectedTagIds, ...parsed.tagIds])],
      life,
      tags,
    ),
    tags,
  );
  const lifeTint = LIFE_META[captureArea];

  const td = iso(new Date(), timeZone);
  const tomorrow = iso(addDays(1, new Date(), timeZone), timeZone);

  const toggleTag = (id: string) => {
    setSelectedTagIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  };

  const close = () => setOpen(false);

  const submit = () => {
    const trimmed = text.trim();
    if (!trimmed) return;
    if (mode === "assistant") {
      setText("");
      close();
      // Land on /assistant first so the thinking state is what you see.
      router.push("/assistant");
      assistant.run(trimmed);
      return;
    }
    startTransition(async () => {
      const res = await createFromOmni({
        text: trimmed,
        type,
        projectId: type === "task" ? capture.projectId : undefined,
        due:
          type === "task" ? (parsed.due ?? pickedDue ?? undefined) : undefined,
        priority: type === "task" ? pickedPriority : undefined,
        goalCategory: type === "goal" ? capture.goalCategory : undefined,
        lifeView: life,
        tagIds: selectedTagIds,
      });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(res.data?.label ?? "Added", {
        action: res.undo
          ? {
              label: "UNDO",
              onClick: async () => {
                await undoCreate(
                  res.undo!.entity,
                  res.undo!.snapshot as string,
                );
                router.refresh();
              },
            }
          : undefined,
      });
      setText("");
      setSelectedTagIds([]);
      close();
      router.refresh();
    });
  };

  const activeType = TYPES.find((t) => t.type === type)!;
  const submitLabel =
    mode === "assistant"
      ? busy
        ? "Thinking…"
        : "Send to assistant"
      : `Add ${activeType.label.toLowerCase()}`;

  return (
    <div className="lg:hidden">
      <div className="mb-3 flex items-center gap-2">
        <button
          type="button"
          onClick={() => openWith(capture.type)}
          className="flex min-w-0 flex-1 items-center gap-2.5 rounded-full border-2 border-ink bg-surface px-4 py-2.5 text-left"
        >
          <Search className="h-4 w-4 shrink-0 text-faint" strokeWidth={2.2} />
          <span className="truncate text-[14px] font-medium text-faint">
            Capture or ask the assistant…
          </span>
        </button>
        {/* Twin of the bottom-right dock shortcut — same button, same action */}
        <button
          key={sectionMetaFor(pathname).color}
          type="button"
          aria-label="Capture"
          onClick={() => openWith(capture.type)}
          className="group flex h-10 w-10 shrink-0 animate-pumma-pop items-center justify-center rounded-full border-2 border-background text-background shadow-[0_4px_14px_rgba(0,0,0,0.25)] transition-all duration-300 hover:scale-105 active:scale-90"
          style={{ background: sectionMetaFor(pathname).color }}
        >
          <Plus
            className="h-[18px] w-[18px] transition-transform duration-200 group-active:rotate-90"
            strokeWidth={2.6}
          />
        </button>
      </div>

      {open && (
        <div
          className="fixed inset-0 z-[70] flex flex-col bg-background"
          style={{ paddingTop: "calc(0.5rem + env(safe-area-inset-top))" }}
        >
          {/* Header */}
          <div className="flex shrink-0 items-center justify-between px-4 pb-1">
            <span className="font-mono text-[11px] font-semibold uppercase tracking-widest text-faint">
              {mode === "capture" ? "Capture" : "Assistant"}
            </span>
            <div className="flex items-center gap-2">
              {mode === "capture" && lifeTint && (
                <span
                  className="rounded-lg border px-2.5 py-1 font-mono text-[12px] font-semibold"
                  style={{
                    borderColor: lifeTint.border,
                    background: lifeTint.bg,
                    color: lifeTint.text,
                  }}
                >
                  → {lifeTint.label}
                </span>
              )}
              <button
                type="button"
                onClick={close}
                aria-label="Close capture"
                className="flex h-10 w-10 items-center justify-center rounded-full border border-border bg-surface text-ink"
              >
                <X className="h-4.5 w-4.5" />
              </button>
            </div>
          </div>

          {/* Big input */}
          <div className="shrink-0 px-4 pt-1">
            <textarea
              autoFocus
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  submit();
                }
              }}
              rows={2}
              placeholder={
                mode === "capture"
                  ? capture.placeholder
                  : "Ask about your data, or describe what to build…"
              }
              className="w-full resize-none rounded-2xl border-2 border-ink bg-surface px-4 py-3.5 text-[17px] font-medium leading-snug text-ink outline-none placeholder:text-faint"
            />
            {mode === "capture" && parsed.dateLabel && (
              <span className="mt-1.5 inline-block rounded-md bg-primary/10 px-2 py-0.5 font-mono text-[12px] text-primary">
                📅 {parsed.dateLabel}
              </span>
            )}
          </div>

          {/* Mode switch */}
          <div className="shrink-0 px-4 pt-3">
            <div className="grid grid-cols-2 gap-1 rounded-2xl border border-border bg-surface2 p-1">
              {(
                [
                  ["capture", "Capture", Pencil],
                  ["assistant", "Assistant", Sparkles],
                ] as const
              ).map(([m, label, Icon]) => {
                const active = mode === m;
                return (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setMode(m)}
                    className={cn(
                      "flex items-center justify-center gap-1.5 rounded-xl py-2.5 text-[13px] font-semibold transition-all",
                      active
                        ? m === "assistant"
                          ? "bg-primary text-background"
                          : "bg-surface text-ink shadow-[1px_1px_0_var(--shadow)]"
                        : "text-faint",
                    )}
                  >
                    <Icon className="h-4 w-4" />
                    {label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Scrollable options — the whole vertical space works for you */}
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-4 pt-4">
            {mode === "capture" ? (
              <>
                <p className="mb-2 font-mono text-[10px] font-semibold uppercase tracking-widest text-faint2">
                  Save as
                </p>
                <div className="mb-5 grid grid-cols-4 gap-2">
                  {TYPES.map((t) => {
                    const active = type === t.type;
                    return (
                      <button
                        key={t.type}
                        type="button"
                        onClick={() => setType(t.type)}
                        className={cn(
                          "flex flex-col items-center gap-1.5 rounded-2xl border py-3 text-[13px] transition-all",
                          active
                            ? "border-2 font-bold shadow-[2px_2px_0_var(--shadow)]"
                            : "border-border bg-surface font-medium text-muted",
                        )}
                        style={
                          active
                            ? {
                                borderColor: t.color,
                                background: t.color.includes("oklch")
                                  ? t.color.replace(")", " / 0.14)")
                                  : "var(--hover)",
                              }
                            : undefined
                        }
                      >
                        <span
                          className={cn(
                            "h-2.5 w-2.5",
                            t.shape === "square" && "rounded-[3px]",
                            t.shape === "dot" && "rounded-full",
                            t.shape === "diamond" && "rotate-45",
                          )}
                          style={{ background: t.color }}
                        />
                        {t.label}
                      </button>
                    );
                  })}
                </div>

                {isTask && !parsed.dateLabel && (
                  <>
                    <p className="mb-2 font-mono text-[10px] font-semibold uppercase tracking-widest text-faint2">
                      Due
                    </p>
                    <div className="mb-5 flex items-center gap-2">
                      {(
                        [
                          [td, "Today"],
                          [tomorrow, "Tomorrow"],
                        ] as const
                      ).map(([value, label]) => {
                        const active = pickedDue === value;
                        return (
                          <button
                            key={value}
                            type="button"
                            onClick={() => setPickedDue(active ? null : value)}
                            className={cn(
                              "rounded-xl border px-4 py-2.5 font-mono text-[13px] font-semibold transition-colors",
                              active
                                ? "border-primary bg-primary/10 text-primary"
                                : "border-border bg-surface text-muted",
                            )}
                          >
                            {label}
                          </button>
                        );
                      })}
                      <label className="flex items-center gap-1.5 rounded-xl border border-border bg-surface px-3 py-2 font-mono text-[13px] text-muted">
                        <CalendarDays className="h-4 w-4" />
                        <input
                          type="date"
                          value={
                            pickedDue &&
                            pickedDue !== td &&
                            pickedDue !== tomorrow
                              ? pickedDue
                              : ""
                          }
                          onChange={(e) => setPickedDue(e.target.value || null)}
                          className="w-[7.5rem] border-none bg-transparent text-[13px] text-ink outline-none"
                        />
                      </label>
                    </div>
                  </>
                )}

                {isTask && !parsed.hasPriorityToken && (
                  <>
                    <p className="mb-2 font-mono text-[10px] font-semibold uppercase tracking-widest text-faint2">
                      Priority
                    </p>
                    <div className="mb-5 flex items-center gap-2">
                      {PRIORITY_OPTIONS.map(({ value, label }) => {
                        const active = pickedPriority === value;
                        return (
                          <button
                            key={value}
                            type="button"
                            onClick={() => setPickedPriority(value)}
                            aria-pressed={active}
                            className={cn(
                              "flex items-center gap-1.5 rounded-xl border px-4 py-2.5 font-mono text-[13px] font-semibold transition-colors",
                              active
                                ? "border-2"
                                : "border-border bg-surface text-muted",
                            )}
                            style={
                              active
                                ? {
                                    borderColor: PRIORITY_COLOR[value],
                                    background: PRIORITY_COLOR[value].replace(
                                      ")",
                                      " / 0.12)",
                                    ),
                                    color: PRIORITY_COLOR[value],
                                  }
                                : undefined
                            }
                          >
                            <span
                              aria-hidden
                              className="w-3 text-center text-[17px] font-bold leading-[13px]"
                              style={
                                active
                                  ? undefined
                                  : { color: PRIORITY_COLOR[value] }
                              }
                            >
                              {PRIORITY_GLYPH[value]}
                            </span>
                            {label}
                          </button>
                        );
                      })}
                    </div>
                  </>
                )}

                {tags.length > 0 && (
                  <>
                    <p className="mb-2 font-mono text-[10px] font-semibold uppercase tracking-widest text-faint2">
                      Tags
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {tags.map((tg) => {
                        const active = selectedTagIds.includes(tg.id);
                        return (
                          <button
                            key={tg.id}
                            type="button"
                            onClick={() => toggleTag(tg.id)}
                            className={cn(
                              "rounded-xl border px-3.5 py-2 font-mono text-[13px] font-medium transition-all",
                              active
                                ? "border-2 font-semibold"
                                : "border-border bg-surface text-muted",
                            )}
                            style={
                              active
                                ? {
                                    borderColor: tg.color,
                                    background: tagBg(tg.color),
                                    color: tg.color,
                                  }
                                : undefined
                            }
                          >
                            {tg.name}
                          </button>
                        );
                      })}
                    </div>
                  </>
                )}
              </>
            ) : (
              <p className="rounded-2xl border border-dashed border-border bg-surface2/50 px-4 py-5 text-center text-[13.5px] leading-relaxed text-faint">
                Ask a question about your own data, or describe a change to make
                — the assistant works out which you meant. Changes arrive as a
                draft you review before anything is saved.
              </p>
            )}
          </div>

          {/* Pinned submit */}
          <div
            className="shrink-0 border-t border-border2 bg-background px-4 pt-3"
            style={{
              paddingBottom: "calc(0.75rem + env(safe-area-inset-bottom))",
            }}
          >
            <button
              type="button"
              onClick={submit}
              disabled={pending || busy || !text.trim()}
              className={cn(
                "w-full rounded-2xl py-3.5 text-[15px] font-bold text-background transition-opacity disabled:opacity-40",
                mode === "assistant" ? "bg-primary" : "bg-ink",
              )}
            >
              {pending ? "Adding…" : submitLabel}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
