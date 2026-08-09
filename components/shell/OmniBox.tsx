"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import type { EntityLifeArea, OmniType } from "@/lib/types";
import type { Project, Tag, Task, Note } from "@/lib/schemas";
import { iso } from "@/lib/date";
import { parseOmni } from "@/lib/parse";
import { getCaptureContext } from "@/lib/capture-context";
import { createFromOmni, undoCreate } from "@/lib/actions/tasks";
import { cn } from "@/lib/utils";
import { useLifeView } from "@/components/shell/LifeAreaToggle";
import { lifeAreaForCreate } from "@/lib/life-area";
import {
  deriveLifeAreaFromTags,
  withLifeTags,
  goalCategoryForLifeArea,
} from "@/lib/life-area-sync";
import { TagQuickPick, SelectedTagsTray } from "@/components/shell/TagQuickPick";
import { DueQuickPick } from "@/components/shell/DueQuickPick";
import { PriorityQuickPick } from "@/components/shell/PriorityQuickPick";
import type { TaskPriority } from "@/lib/types";
import { OmniHighlightInput } from "@/components/shell/OmniHighlightInput";
import { isEditableTarget } from "@/lib/is-editable-target";
import {
  completeOmniToken,
  cycleTypeAtCaret,
  tokenAtCaret,
} from "@/lib/omni-complete";
import { RESERVED_TYPE_WORDS, RESERVED_WORDS } from "@/lib/omni-reserved";
import { useAssistant } from "@/components/assistant/AssistantProvider";
import { isTutorialActive } from "@/lib/tutorial-lock";
import { useTimezone } from "@/components/shell/TimeZoneProvider";
import { Pencil, Sparkles } from "lucide-react";

type OmniMode = "capture" | "assistant";

const TYPE_META: Record<
  OmniType,
  { label: string; color: string; text: string }
> = {
  task: { label: "#task", color: "oklch(0.64 0.18 25)", text: "oklch(0.5 0.18 25)" },
  habit: { label: "#habit", color: "oklch(0.6 0.13 155)", text: "oklch(0.44 0.13 155)" },
  goal: { label: "#goal", color: "oklch(0.58 0.17 300)", text: "oklch(0.46 0.17 300)" },
  note: { label: "#note", color: "var(--faint)", text: "var(--muted)" },
};

const OMNI_TYPES: OmniType[] = ["task", "habit", "goal", "note"];

/** Tab order while typing in the omnibar: capture types → assistant → capture… */
const OMNI_TAB_CYCLE: { mode: OmniMode; type?: OmniType }[] = [
  { mode: "capture", type: "task" },
  { mode: "capture", type: "habit" },
  { mode: "capture", type: "goal" },
  { mode: "capture", type: "note" },
  { mode: "assistant" },
];

function omniAccent(type: OmniType): string {
  return type === "note" ? "var(--ink)" : TYPE_META[type].color;
}

// Where a capture will land — same palette as the sidebar Personal/Work toggle.
// "both" stays neutral (no tint) so only an explicit area shouts.
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

function omniTabIndex(mode: OmniMode, type: OmniType): number {
  if (mode === "assistant") return 4;
  const i = OMNI_TYPES.indexOf(type);
  return i >= 0 ? i : 0;
}

function cycleOmniTab(
  mode: OmniMode,
  type: OmniType,
  direction: 1 | -1
): { mode: OmniMode; type: OmniType } {
  const next =
    OMNI_TAB_CYCLE[
      (omniTabIndex(mode, type) + direction + OMNI_TAB_CYCLE.length) %
        OMNI_TAB_CYCLE.length
    ];
  return { mode: next.mode, type: next.type ?? type };
}

type Props = {
  tags: Tag[];
  tasks: Task[];
  notes: Note[];
  projects: Project[];
  defaultType?: OmniType;
  defaultDueToday?: boolean;
};

export function OmniBox({
  tags,
  tasks,
  notes,
  projects,
  defaultType = "task",
  defaultDueToday = true,
}: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [life] = useLifeView();
  const [text, setText] = useState("");
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);
  const [pickedDue, setPickedDue] = useState<string | null>(null);
  const [pickedPriority, setPickedPriority] = useState<TaskPriority>("med");
  const [type, setType] = useState<OmniType>(defaultType);
  const [mode, setMode] = useState<OmniMode>("capture");
  const [pending, startTransition] = useTransition();
  const assistant = useAssistant();
  const timeZone = useTimezone();
  const inputRef = useRef<HTMLInputElement>(null);
  const omniRef = useRef<HTMLDivElement>(null);
  const omniEscBlurredAtRef = useRef<number | null>(null);
  const busy = assistant.status === "pending";
  const aiMode = mode === "assistant";

  // Everything you can capture carries tags — habits and goals included, since
  // their life area is read from them like everything else's.
  const taggable = mode === "capture";
  const isTask = type === "task";
  const agendaDay =
    pathname === "/" ? searchParams.get("day")?.slice(0, 10) ?? null : null;

  const toggleTag = (tagId: string) => {
    setSelectedTagIds((prev) =>
      prev.includes(tagId)
        ? prev.filter((id) => id !== tagId)
        : [...prev, tagId]
    );
  };

  const removeTag = (tagId: string) => {
    setSelectedTagIds((prev) => prev.filter((id) => id !== tagId));
  };

  const capture = useMemo(
    () =>
      getCaptureContext(
        pathname,
        searchParams,
        defaultType,
        projects.map((p) => ({ id: p.id, title: p.title }))
      ),
    [pathname, searchParams, defaultType, projects]
  );

  useEffect(() => {
    setType(capture.type);
  }, [capture.type, pathname, searchParams]);

  // On the Assistant page the bar IS the assistant's input — there is no
  // second field there to type into. Leaving it takes you back to capture.
  useEffect(() => {
    setMode(pathname === "/assistant" ? "assistant" : "capture");
  }, [pathname]);

  useEffect(() => {
    if (!taggable) setSelectedTagIds([]);
  }, [taggable]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // The tour owns the keyboard while it's up (see lib/tutorial-lock).
      if (isTutorialActive()) return;
      if (e.defaultPrevented || e.isComposing) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key.length !== 1) return;
      if (isEditableTarget(document.activeElement)) return;

      e.preventDefault();
      inputRef.current?.focus();
      omniEscBlurredAtRef.current = null;
      setText((prev) => prev + e.key);
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // Capture and plan/ask render different input elements, so a cycle can swap
  // the node out from under the ref. Focusing from the key handler (or a
  // requestAnimationFrame inside it) lands before React commits the swap and
  // hits the node on its way out — so the request is recorded here and honoured
  // in an effect, once the new input actually exists.
  const wantFocusRef = useRef(false);
  /** Where the last Tab completion left the caret, and which option it showed. */
  const rotateRef = useRef<{
    from: string;
    index: number;
    base: string;
  } | null>(null);

  useEffect(() => {
    if (!wantFocusRef.current) return;
    wantFocusRef.current = false;
    const el = inputRef.current;
    if (!el) return;
    el.focus();
    const end = el.value?.length ?? 0;
    try {
      el.setSelectionRange(end, end);
    } catch {
      // Some input types reject selection ranges; focus alone is enough.
    }
  }, [mode, type]);

  // Tab drives the omnibar from anywhere on the page. It lives on the window
  // rather than the input because switching to plan/ask swaps the input element
  // itself — the old handler died with the unmounted node, which is why the
  // press after a switch went to the browser and moved focus to a button
  // instead of cycling.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // The tour owns the keyboard while it's up (see lib/tutorial-lock).
      if (isTutorialActive()) return;
      if (e.key !== "Tab" || e.defaultPrevented || e.isComposing) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      const active = document.activeElement;
      // Someone typing in another field keeps normal Tab — that's their form's
      // business, not ours.
      if (active !== inputRef.current && isEditableTarget(active)) return;
      // Dialogs, sheets and popovers keep normal Tab too, or they stop being
      // navigable by keyboard at all once open.
      if (
        active instanceof HTMLElement &&
        active.closest('[role="dialog"], [data-radix-popper-content-wrapper]')
      ) {
        return;
      }

      // Half-typed "#gam" or "!hi"? Tab finishes the word rather than
      // switching type — completing what you're writing is the more specific
      // intent, and there's nothing to complete the rest of the time.
      const el = inputRef.current;
      if (el && active === el && !e.shiftKey) {
        const selStart = el.selectionStart ?? el.value.length;
        const selEnd = el.selectionEnd ?? selStart;
        // The last press left its guess SELECTED after the caret. Complete
        // against the text without it — the way typing over a selection
        // works — or the leftover gets spliced in and "#prime" cycles to
        // "#pummarime".
        const value = el.value.slice(0, selStart) + el.value.slice(selEnd);
        const caretNow = selStart;
        const before = value.slice(0, caretNow);
        // Tab again on the same token steps to the next option; touching the
        // text at all starts the cycle over from the narrowed set.
        const again = rotateRef.current?.from === before;

        // A token that is already a type spelled out in full — "#task" — has
        // nothing left to complete, so Tab means "not that one, the next one"
        // and swaps it for "#habit". Only when not mid-cycle: rotating from
        // "#h" passes through "habit" on its way to "health", and stealing
        // that press would strand the rotation.
        // A bare "#" is left alone: Tab there already cycles the bar's own
        // capture type below, which is the same intent by another route.
        const bareHash = tokenAtCaret(value, caretNow)?.word === "";
        if (!again && !bareHash) {
          // Forwards only: this whole branch is behind `!e.shiftKey`, and
          // shift-Tab is already spoken for by the backwards mode cycle below.
          const cycled = cycleTypeAtCaret(value, caretNow, RESERVED_TYPE_WORDS);
          if (cycled) {
            e.preventDefault();
            setText(cycled.text);
            // Nothing to remember: the next press re-reads the token, finds
            // another type word, and steps on from there.
            rotateRef.current = null;
            requestAnimationFrame(() =>
              el.setSelectionRange(cycled.caret, cycled.caret)
            );
            return;
          }
        }

        const done = completeOmniToken(
          value,
          caretNow,
          [...tags.map((t) => t.name), ...RESERVED_WORDS],
          again ? rotateRef.current!.index + 1 : undefined,
          again ? rotateRef.current!.base : undefined
        );
        if (done) {
          e.preventDefault();
          setText(done.text);
          // What you actually typed, as opposed to what Tab filled in.
          const typedWord = again
            ? rotateRef.current!.base
            : (tokenAtCaret(value, caretNow)?.word ?? "");
          rotateRef.current = done.exact
            ? null
            : {
                // Measured to the end of YOUR text, not the end of the
                // suggestion — that's where the caret is about to sit, and
                // it's what the next Tab compares against.
                from: done.text.slice(
                  0,
                  done.caret - (done.completion.length - typedWord.length)
                ),
                index: again ? rotateRef.current!.index + 1 : 0,
                // The partial as first typed — the cycle is over that set, not
                // over whatever the last press wrote in.
                base: typedWord,
              };
          requestAnimationFrame(() => {
            if (done.exact) {
              el.setSelectionRange(done.caret, done.caret);
              return;
            }
            // Still cycling: leave the caret after what you typed and SELECT
            // the guessed part, the way a browser address bar does. Type on
            // and the guess is replaced, so "#p" + "u" narrows to "#pu"
            // instead of turning into "#primeu" — before this you had to
            // delete the suggestion to refine it, which made Tab a dead end
            // unless it guessed right first time.
            const typedEnd = done.caret - (done.completion.length - typedWord.length);
            el.setSelectionRange(typedEnd, done.caret);
          });
          return;
        }
      }

      e.preventDefault();
      const next = cycleOmniTab(mode, type, e.shiftKey ? -1 : 1);
      wantFocusRef.current = true;
      setMode(next.mode);
      if (next.mode === "capture") setType(next.type);
      // Covers the case where the cycle doesn't remount the input: the effect
      // below only runs when mode/type actually change the rendered branch.
      inputRef.current?.focus();
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [mode, type, tags, setText]);

  useEffect(() => {
    const OMNI_CLEAR_MS = 3000;

    const onKeyDown = (e: KeyboardEvent) => {
      // The tour owns the keyboard while it's up (see lib/tutorial-lock).
      if (isTutorialActive()) return;
      if (e.key !== "Escape" || e.defaultPrevented) return;
      const root = omniRef.current;
      if (!root) return;

      const omniFocused = root.contains(document.activeElement);

      if (omniFocused) {
        e.preventDefault();
        omniEscBlurredAtRef.current = Date.now();
        (document.activeElement as HTMLElement | null)?.blur();
        return;
      }

      const blurredAt = omniEscBlurredAtRef.current;
      if (blurredAt === null || Date.now() - blurredAt > OMNI_CLEAR_MS) return;

      e.preventDefault();
      omniEscBlurredAtRef.current = null;
      setText("");
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    const root = omniRef.current;
    if (!root) return;
    const onFocusIn = () => {
      omniEscBlurredAtRef.current = null;
    };
    root.addEventListener("focusin", onFocusIn);
    return () => root.removeEventListener("focusin", onFocusIn);
  }, []);

  const parsed = parseOmni(text, tags, undefined, undefined, timeZone);

  // The area this capture will actually land in: the current life view, unless
  // typed/picked work/personal tags override it (mirrors the server's derive
  // rule, so the chip is always truthful).
  const baseArea = lifeAreaForCreate(life);
  // Preview exactly what will be stored: the view's life tags get attached
  // on create unless one was typed or picked explicitly.
  const captureArea: EntityLifeArea = taggable
    ? deriveLifeAreaFromTags(
        withLifeTags(
          [...new Set([...selectedTagIds, ...parsed.tagIds])],
          life,
          tags
        ),
        tags
      )
    : baseArea;
  const lifeTint = LIFE_META[captureArea];
  // The goals page hints which column you're capturing into. That column is
  // the life tag under another name, so a typed "#work" moves the hint too —
  // otherwise the bar would promise Personal and file under Work.
  const captureHint =
    type === "goal"
      ? goalCategoryForLifeArea(captureArea) === "work"
        ? "Work"
        : "Personal"
      : capture.hint;
  // Only tint when the view (or a tag) pins an area; the Both view stays neutral.
  const showLifeSignal =
    mode === "capture" && (life !== "both" || captureArea !== baseArea);

  // Only fall back to today when the setting says so — this used to hardcode
  // today, which silently overrode "default due today: off" (the capture bar
  // sent an explicit date, so the server never got to apply the setting).
  const defaultTaskDue =
    capture.due?.slice(0, 10) ??
    agendaDay ??
    (defaultDueToday ? iso(new Date(), timeZone) : null);

  useEffect(() => {
    if (!isTask) {
      setPickedDue(null);
      return;
    }
    if (parsed.due) {
      setPickedDue(null);
    }
  }, [isTask, parsed.due]);

  // "#ask" and "#plan" in the text both steer the bar to the assistant — they
  // were two doors to one room even before the modes merged.
  useEffect(() => {
    if (parsed.modeToken && mode !== "assistant") setMode("assistant");
  }, [parsed.modeToken, mode]);

  useEffect(() => {
    if (parsed.typeToken && parsed.typeToken !== type) {
      setMode("capture");
      setType(parsed.typeToken);
    }
  }, [parsed.typeToken, type]);

  const submit = () => {
    const trimmed = text.trim();
    if (!trimmed) return;
    const taskDue = parsed.due ?? pickedDue ?? defaultTaskDue;

    startTransition(async () => {
      const res = await createFromOmni({
        text: trimmed,
        type,
        projectId: type === "task" ? capture.projectId : undefined,
        due: type === "task" ? taskDue : undefined,
        priority: type === "task" ? pickedPriority : undefined,
        goalCategory: type === "goal" ? capture.goalCategory : undefined,
        lifeView: life,
        tagIds: taggable ? selectedTagIds : undefined,
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
                await undoCreate(res.undo!.entity, res.undo!.snapshot as string);
                router.refresh();
              },
            }
          : undefined,
      });
      setText("");
      setSelectedTagIds([]);
      setPickedDue(defaultTaskDue);
      setPickedPriority("med");
      router.refresh();
    });
  };

  // One entry point: the assistant works out whether this is a question or a
  // request. Plan and Ask were only ever a guess the user had to make first.
  // Navigate BEFORE firing the run — the user should be watching the
  // assistant think, not staring at whatever page they typed from.
  const onAiSubmit = () => {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    setText("");
    router.push("/assistant");
    assistant.run(trimmed);
  };

  return (
    <div
      ref={omniRef}
      className="omni-box group mb-3 shrink-0 rounded-[14px] border-2 border-ink bg-surface p-[10px_12px] transition-colors lg:mb-[18px] lg:p-[13px_16px]"
      style={
        {
          "--omni-accent":
            mode === "assistant" ? "var(--primary)" : omniAccent(type),
          ...(showLifeSignal && lifeTint
            ? { borderColor: lifeTint.border }
            : {}),
        } as React.CSSProperties
      }
    >
      <div className="omni-box-motion" aria-hidden>
        <div className="omni-box-trace" />
        <div className="omni-box-shimmer" />
      </div>

      <div className="relative z-[1]">
      <div className="flex items-center gap-[11px] max-lg:flex-wrap">
        <ModeSwitch mode={mode} onChange={setMode} />
        {/* No type pill in assistant mode — the switch beside it already says
            Assistant, and there is only one kind of assistant input now. */}
        {mode === "capture" && (
          <span
            className="shrink-0 rounded-[7px] px-[9px] py-1 font-mono text-xs font-semibold lowercase text-background transition-transform duration-200 group-focus-within:scale-[1.04]"
            style={{ background: TYPE_META[type].color }}
          >
            {TYPE_META[type].label}
          </span>
        )}
        {showLifeSignal && (
          <span
            className={cn(
              "shrink-0 whitespace-nowrap rounded-[7px] border px-2 py-0.5 font-mono text-[11px] font-semibold transition-colors",
              !lifeTint && "border-border bg-hover text-muted"
            )}
            style={
              lifeTint
                ? {
                    borderColor: lifeTint.border,
                    background: lifeTint.bg,
                    color: lifeTint.text,
                  }
                : undefined
            }
            title="Where this capture will land — follows the Personal/Work view, and work/personal tags override it"
          >
            → {lifeTint?.label ?? "Both"}
          </span>
        )}
        {mode === "capture" && captureHint && (
          <span className="hidden shrink-0 font-mono text-[10px] text-faint transition-colors duration-200 group-focus-within:text-muted md:inline">
            → {captureHint}
          </span>
        )}
        {mode === "capture" ? (
          <OmniHighlightInput
            ref={inputRef}
            tags={tags}
            showTags
            showPriority={isTask}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                submit();
              }
            }}
            placeholder={capture.placeholder}
            disabled={pending || busy}
          />
        ) : (
          <input
            ref={inputRef}
            className="w-full border-none bg-transparent text-base font-medium text-ink outline-none transition-colors duration-200 placeholder:text-faint placeholder:transition-colors group-focus-within:placeholder:text-faint2"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (aiMode) {
                if (e.key === "Enter") {
                  e.preventDefault();
                  onAiSubmit();
                }
                return;
              }
              if (e.key === "Enter") {
                e.preventDefault();
                submit();
              }
            }}
            placeholder={
              mode === "assistant"
                ? "Ask about your data, or describe something to change…"
                : capture.placeholder
            }
            disabled={pending || busy}
          />
        )}
        {mode === "capture" && parsed.dateLabel && (
          <span className="shrink-0 whitespace-nowrap rounded-md bg-primary/10 px-2 py-0.5 font-mono text-[11px] text-primary">
            📅 {parsed.dateLabel}
          </span>
        )}
        <span className="hidden shrink-0 font-mono text-[10px] text-faint2 transition-all duration-200 group-focus-within:font-semibold group-focus-within:text-ink sm:inline">
          {mode === "assistant" ? "↵ send" : "↵ add"}
        </span>
      </div>
      <div className="omni-box-scanline" aria-hidden />
      {aiMode ? (
        <div className="mt-2.5 flex items-center gap-2 border-t border-border2 py-2.5 pb-1">
          <span className="shrink-0 font-mono text-[10px] text-faint2">
            A question gets an answer · a request gets a draft you can edit
          </span>
          <button
            type="button"
            onClick={onAiSubmit}
            disabled={busy}
            className="ml-auto cursor-pointer rounded-lg border-none bg-primary px-4 py-1 text-[12px] font-bold text-background disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? "Thinking…" : "Send"}
          </button>
        </div>
      ) : (
      <div className="mt-2.5 flex min-w-0 items-center gap-2 overflow-x-auto border-t border-border2 py-2.5 pb-3 [scrollbar-width:none] lg:overflow-visible">
        <span className="shrink-0 font-mono text-[10px] text-faint2">TAB FOR →</span>
        <div className="flex shrink-0 items-center gap-1">
          <TypeChip
            label="Task"
            dot="oklch(0.64 0.18 25)"
            accent="oklch(0.64 0.18 25)"
            textColor={TYPE_META.task.text}
            square
            active={type === "task"}
            onClick={() => setType("task")}
          />
          <TypeChip
            label="Habit"
            dot="oklch(0.6 0.13 155)"
            accent="oklch(0.6 0.13 155)"
            textColor={TYPE_META.habit.text}
            active={type === "habit"}
            onClick={() => setType("habit")}
          />
          <TypeChip
            label="Goal"
            dot="oklch(0.58 0.17 300)"
            accent="oklch(0.58 0.17 300)"
            textColor={TYPE_META.goal.text}
            diamond
            active={type === "goal"}
            onClick={() => setType("goal")}
          />
          <TypeChip
            label="Note"
            dot="var(--faint)"
            accent="var(--ink)"
            textColor="var(--ink)"
            square
            active={type === "note"}
            onClick={() => setType("note")}
          />
        </div>
        {isTask && !parsed.dateLabel && (
          <>
            <span className="h-3.5 w-px shrink-0 bg-border" aria-hidden />
            <DueQuickPick
              mode="capture"
              value={pickedDue}
              onChange={setPickedDue}
              disabled={pending}
              // With the setting off, nothing is due by default — so the picker
              // must be able to render "no date" instead of highlighting Today.
              nullable={!defaultDueToday}
              clearable={!defaultDueToday}
              clearLabel="No date"
            />
          </>
        )}
        {isTask && !parsed.hasPriorityToken && (
          <>
            <span className="h-3.5 w-px shrink-0 bg-border" aria-hidden />
            <PriorityQuickPick
              value={pickedPriority}
              onChange={setPickedPriority}
              disabled={pending}
            />
          </>
        )}
        {taggable && (
          <>
            <span className="h-3.5 w-px shrink-0 bg-border" aria-hidden />
            <TagQuickPick
              tags={tags}
              tasks={tasks}
              notes={notes}
              selectedTagIds={selectedTagIds}
              onToggle={toggleTag}
              showLabel={false}
            />
          </>
        )}
        <div className="ml-auto flex shrink-0 items-center gap-2">
          {taggable && (
            <SelectedTagsTray
              selectedTagIds={selectedTagIds}
              allTags={tags}
              onRemove={removeTag}
            />
          )}
          <button
            type="button"
            onClick={submit}
            disabled={pending}
            className="cursor-pointer rounded-lg border-none bg-ink px-4 py-1 text-[12px] font-bold text-background"
          >
            Add
          </button>
        </div>
      </div>
      )}
      </div>
    </div>
  );
}

function ModeSwitch({
  mode,
  onChange,
}: {
  mode: OmniMode;
  onChange: (mode: OmniMode) => void;
}) {
  return (
    <div className="flex shrink-0 items-center gap-0.5 rounded-[9px] border border-border bg-surface2 p-0.5">
      <button
        type="button"
        onClick={() => onChange("capture")}
        aria-pressed={mode === "capture"}
        className={cn(
          "flex items-center gap-1 rounded-[7px] px-2 py-1 text-[11px] font-semibold transition-all",
          mode === "capture"
            ? "bg-surface text-ink shadow-[1px_1px_0_var(--shadow)]"
            : "text-faint hover:text-muted"
        )}
      >
        <Pencil className="h-3 w-3" />
        Capture
      </button>
      <button
        type="button"
        onClick={() => onChange("assistant")}
        aria-pressed={mode === "assistant"}
        className={cn(
          "flex items-center gap-1 rounded-[7px] px-2 py-1 text-[11px] font-semibold transition-all",
          mode === "assistant"
            ? "bg-primary text-background shadow-[1px_1px_0_var(--shadow)]"
            : "text-faint hover:text-muted"
        )}
      >
        <Sparkles className="h-3 w-3" />
        Assistant
      </button>
    </div>
  );
}

function TypeChip({
  label,
  dot,
  accent,
  textColor,
  square,
  diamond,
  active,
  onClick,
}: {
  label: string;
  dot: string;
  accent: string;
  textColor: string;
  square?: boolean;
  diamond?: boolean;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex cursor-pointer items-center gap-1 rounded-lg px-2 py-1 text-[11px] transition-all",
        active
          ? "border-2 font-bold shadow-[2px_2px_0_var(--shadow)]"
          : "border border-border bg-surface font-medium text-muted opacity-75 hover:border-faint hover:opacity-100"
      )}
      style={
        active
          ? {
              borderColor: accent,
              background: accent.includes("oklch")
                ? accent.replace(")", " / 0.28)")
                : "var(--hover)",
              color: textColor,
            }
          : undefined
      }
    >
      <span
        className={cn(
          "h-[6px] w-[6px]",
          square && "rounded-[2px]",
          !square && !diamond && "rounded-full",
          diamond && "rotate-45"
        )}
        style={{ background: dot }}
      />
      {label}
    </button>
  );
}
