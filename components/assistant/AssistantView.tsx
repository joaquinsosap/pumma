"use client";

// The unified assistant workspace: one input, and the result is either an
// answer (widgets) or a changeset (an editable canvas). See ChangesetCanvas
// for the editing half.
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { KeyRound } from "@/components/icons";
import { Topbar } from "@/components/shell/Topbar";
import { AskDashboard } from "@/components/assistant/AskDashboard";
import { ChangesetCanvas } from "@/components/assistant/ChangesetCanvas";
import { useAssistant } from "@/components/assistant/AssistantProvider";
import { ScopeScreen } from "@/components/assistant/ScopeScreen";
import { draftFromScopeAction } from "@/lib/actions/scope";
import type { AssistOutcome } from "@/lib/ai/assist";
import type { ResolvedScope, Scope } from "@/lib/ai/scope-schema";
import type { Changeset } from "@/lib/ai/changeset-schema";
import { readBulkOverride, type DevBulk } from "@/lib/ai/scope-dev";
import { describeScope } from "@/lib/ai/scope-schema";
import type { Tag } from "@/lib/schemas";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

type Props = {
  stats: { dayPct: number; habitsLabel: string; topStreak: number };
  birthDate?: string | null;
  lifeSpanYears?: number;
  /** False when no usable AI key is configured for this account. */
  aiReady?: boolean;
  /** For the scope screen's tag chips, which show their real colours. */
  tags?: Tag[];
};

// Examples earn their place by showing something the assistant can do that
// isn't obvious — a chart it picks itself, a multi-step edit, a merge that
// moves work before deleting. "Set up a project for X" taught nothing: it
// produced one empty project and looked like a worse version of the + button.
const ASK_EXAMPLES = [
  "Where did my time actually go this month?",
  "Which projects have I not touched in two weeks?",
  "Am I finishing more than I start?",
  "How am I tracking against my goals?",
];

const BUILD_EXAMPLES = [
  "File my unfiled tasks into the projects they belong to",
  "Merge my two smallest projects into one",
  "Make everything overdue high priority",
  "Archive the habits I haven't done in a month",
];

/** An empty resolve, so the dev screen mounts and then loads real rows. */
const EMPTY_RESOLVED: ResolvedScope = {
  ids: [],
  rows: [],
  excluded: [],
  matched: 0,
  capped: false,
};

export function AssistantView({
  stats,
  birthDate = null,
  lifeSpanYears,
  tags = [],
  aiReady = true,
}: Props) {
  const { status, outcome, error, intent, run, flipMode, clear } =
    useAssistant();
  // `?bulk=1` in development opens the scope screen with a fabricated request,
  // so it can be worked on without paying for a generation. Compiled out of
  // production entirely — see lib/ai/scope-dev.
  const [devBulk, setDevBulk] = useState<DevBulk>(null);
  useEffect(() => setDevBulk(readBulkOverride()), []);

  return (
    <>
      <Topbar
        title="Assistant"
        dayPct={stats.dayPct}
        habitsLabel={stats.habitsLabel}
        topStreak={stats.topStreak}
        birthDate={birthDate}
        lifeSpanYears={lifeSpanYears}
      />
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto pb-6 max-lg:pb-28 animate-pumma-view">
        {!aiReady ? (
          <ApiKeyNeeded />
        ) : status === "pending" ? (
          <Thinking intent={intent} />
        ) : status === "error" ? (
          <ErrorState
            error={error}
            intent={intent}
            onRetry={() => intent && run(intent)}
          />
        ) : devBulk ? (
          <BulkStep
            key="dev-bulk"
            outcome={{ ...devBulk, kind: "bulk", resolved: EMPTY_RESOLVED }}
            intent="give the highest priority to the oldest 3 tasks"
            tags={tags}
            // Stands down once it has produced a draft. In the real flow the
            // outcome itself changes from bulk to changeset and this branch
            // stops matching; the override has to let go by hand or it keeps
            // winning and the canvas never renders.
            onDiscard={() => setDevBulk(null)}
          />
        ) : status === "ready" && outcome?.kind === "bulk" ? (
          <BulkStep
            key={intent ?? "bulk"}
            outcome={outcome}
            intent={intent ?? ""}
            tags={tags}
            onDiscard={clear}
          />
        ) : status === "ready" && outcome?.kind === "changeset" ? (
          <ChangesetCanvas
            key={intent ?? "changeset"}
            changeset={outcome.changeset}
            intent={intent ?? ""}
            onFlipMode={flipMode}
            onDiscard={clear}
          />
        ) : status === "ready" && outcome?.kind === "answer" ? (
          <div className="flex flex-col gap-4">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0">
                <div className="mb-2 flex items-center gap-2">
                  <span className="block h-2 w-2 bg-primary" />
                  <span className="font-mono text-[10px] uppercase tracking-widest text-faint2">
                    Answer
                  </span>
                </div>
                <p className="m-0 max-w-[60ch] text-[17px] font-semibold leading-snug tracking-tight text-ink">
                  {outcome.answer.answer}
                </p>
                {intent && (
                  <p className="m-0 mt-1.5 text-[13px] text-muted">
                    You asked: <span className="text-ink">“{intent}”</span>
                  </p>
                )}
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1.5">
                <button
                  type="button"
                  onClick={flipMode}
                  className="text-[12.5px] text-muted underline underline-offset-2 hover:text-ink"
                >
                  I meant to build this
                </button>
                <button
                  type="button"
                  onClick={clear}
                  className="rounded-md border border-border px-3 py-1 text-[12.5px] text-muted hover:border-faint2"
                >
                  Clear
                </button>
              </div>
            </div>
            <AskDashboard
              result={{ ...outcome.answer, dataMode: outcome.dataMode }}
              hideAnswer
            />
          </div>
        ) : (
          <EmptyState onSubmit={run} />
        )}
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------

function EmptyState({ onSubmit }: { onSubmit: (text: string) => void }) {
  return (
    <div className="flex flex-1 flex-col px-4 pt-8">
      <div className="mx-auto w-full max-w-[560px] text-center">
        <span className="inline-grid h-9 w-9 place-items-center rounded-[9px] bg-primary font-mono text-[15px] font-extrabold text-white">
          A
        </span>
        <p className="m-0 mt-4 text-[20px] font-bold tracking-tight text-ink">
          Ask about your data, or describe what to build.
        </p>
        <p className="m-0 mt-2 text-[13.5px] leading-relaxed text-muted">
          Use the bar above. I read what&apos;s already in PUMMA; when you ask
          for structure I propose the shape. The words inside it stay yours.
        </p>
      </div>

      <div className="mx-auto mt-8 grid w-full max-w-[720px] grid-cols-1 gap-6 sm:grid-cols-2">
        <ExampleColumn label="Ask" examples={ASK_EXAMPLES} onPick={onSubmit} />
        <ExampleColumn
          label="Build"
          examples={BUILD_EXAMPLES}
          onPick={onSubmit}
          accent
        />
      </div>
    </div>
  );
}

function ExampleColumn({
  label,
  examples,
  onPick,
  accent,
}: {
  label: string;
  examples: string[];
  onPick: (text: string) => void;
  accent?: boolean;
}) {
  return (
    <div>
      <p className="m-0 mb-2.5 font-mono text-[10px] uppercase tracking-widest text-faint2">
        {label}
      </p>
      <div className="flex flex-col gap-1.5">
        {examples.map((e) => (
          <button
            key={e}
            type="button"
            onClick={() => onPick(e)}
            className={cn(
              "rounded-full border bg-surface px-3 py-1.5 text-left text-[12.5px] text-muted hover:text-ink",
              accent ? "border-primary" : "border-border hover:border-faint2",
            )}
          >
            {e}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Honest checkpoints instead of a spinner; the mode resolves with the result. */
// What the wait looks like. The phases are theatre — the call is one round
// trip — but honest theatre: they name what the model is actually doing, and
// the ghost dashboard previews the shape of what's coming instead of leaving
// a blank page hanging.
const THINK_PHASES = [
  "Reading your PUMMA",
  "Crunching the numbers",
  "Choosing how to show it",
  "Polishing",
];

function Thinking({ intent }: { intent: string | null }) {
  const [phase, setPhase] = useState(0);
  useEffect(() => {
    const t = setInterval(
      () => setPhase((n) => Math.min(n + 1, THINK_PHASES.length - 1)),
      3200,
    );
    return () => clearInterval(t);
  }, []);

  return (
    <div className="flex flex-1 flex-col gap-6 px-4 pt-8">
      <div className="flex items-start gap-4">
        <span
          className="ask-spinner h-11 w-11 shrink-0 rounded-full"
          aria-hidden
        />
        <div className="min-w-0">
          {intent && (
            <p className="m-0 text-[15px] font-semibold leading-snug text-ink">
              “{intent}”
            </p>
          )}
          <div className="mt-2 flex flex-col gap-1" aria-live="polite">
            {THINK_PHASES.map((label, i) => (
              <span
                key={label}
                className={cn(
                  "flex items-center gap-2 font-mono text-[11px] uppercase tracking-wider transition-all duration-500",
                  i < phase && "text-faint",
                  i === phase && "text-ink",
                  i > phase && "h-0 overflow-hidden opacity-0",
                )}
              >
                {i < phase ? (
                  <Tick />
                ) : (
                  <span className="mx-0.5 block h-2 w-2 animate-pulse rounded-[2px] bg-primary" />
                )}
                {label}
                {i === phase && "…"}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* Ghost dashboard: the answer will land as cards like these. */}
      <div
        className="grid max-w-3xl grid-cols-1 gap-3 md:grid-cols-3"
        aria-hidden
      >
        <GhostCard delay={0}>
          <span className="ask-shimmer block h-8 w-20 rounded-md" />
          <span className="ask-shimmer mt-2 block h-2.5 w-24 rounded" />
        </GhostCard>
        <GhostCard delay={90} className="md:col-span-2">
          {[72, 55, 38].map((w, i) => (
            <span
              key={i}
              className="ask-shimmer mt-2 block h-3.5 rounded first:mt-0"
              style={{ width: `${w}%`, animationDelay: `${i * 0.18}s` }}
            />
          ))}
        </GhostCard>
        <GhostCard delay={180} className="md:col-span-2">
          <span className="ask-shimmer block h-20 w-full rounded-md" />
        </GhostCard>
        <GhostCard delay={270}>
          <span className="ask-spinner mx-auto block h-16 w-16 rounded-full opacity-40" />
        </GhostCard>
      </div>

      <p className="m-0 font-mono text-[10px] text-faint">
        usually 3 to 15s, so feel free to keep working. I&apos;ll be here
      </p>
    </div>
  );
}

function GhostCard({
  delay,
  className,
  children,
}: {
  delay: number;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "ask-card-in rounded-[12px] border border-border bg-surface p-3.5",
        className,
      )}
      style={{ animationDelay: `${delay}ms` }}
    >
      <span className="ask-shimmer mb-2.5 block h-2 w-16 rounded" />
      {children}
    </div>
  );
}

function Tick() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="var(--habits)"
      strokeWidth="2"
      aria-hidden
    >
      <path
        d="M3 8.5 6.5 12 13 4.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ErrorState({
  error,
  intent,
  onRetry,
}: {
  error: string | null;
  intent: string | null;
  onRetry: () => void;
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
      <span className="mb-3 font-mono text-[10px] uppercase tracking-widest text-tasks">
        Couldn&apos;t complete that
      </span>
      <p className="m-0 max-w-md text-[15px] font-semibold text-ink">
        {error ?? "Something went wrong."}
      </p>
      <p className="m-0 mt-1.5 max-w-md text-[13px] text-muted">
        Nothing was changed.
      </p>
      <div className="mt-4 flex gap-2">
        {intent && (
          <button
            type="button"
            onClick={onRetry}
            className="rounded-[9px] bg-ink px-3.5 py-2 text-[12.5px] font-bold text-background"
          >
            Retry
          </button>
        )}
        <Link
          href="/settings"
          className="rounded-[9px] border-[1.5px] border-border bg-surface px-3 py-2 text-[12.5px] font-semibold text-ink no-underline"
        >
          Check Settings
        </Link>
      </div>
    </div>
  );
}

/** Shown when the account has no usable AI key — the assistant can't run. */
function ApiKeyNeeded() {
  return (
    <div className="flex min-h-[280px] flex-col items-center justify-center px-6 text-center">
      <span className="mb-3 flex h-11 w-11 items-center justify-center rounded-xl border border-border bg-surface2 text-primary">
        <KeyRound className="h-5 w-5" />
      </span>
      <div className="text-[15px] font-semibold text-ink">
        The assistant has no key to call.
      </div>
      <p className="mt-1.5 max-w-md text-[13px] leading-relaxed text-muted">
        Pick an AI provider and paste your own key. Everything else in the app
        works without one; the assistant is the only part that doesn&apos;t.
      </p>
      <Link
        href="/settings"
        className="mt-4 inline-flex items-center gap-2 rounded-[10px] bg-ink px-4 py-2 text-[13px] font-bold text-background no-underline transition-opacity hover:opacity-90"
      >
        <KeyRound className="h-3.5 w-3.5" />
        Open Settings
      </Link>
    </div>
  );
}

/**
 * The scope step, and the decision about whether to show it at all.
 *
 * Nothing assumed means the request was fully stated, so it drafts straight
 * away and the user never sees this — the screen is for correcting guesses,
 * not a toll booth on every request.
 */
function BulkStep({
  outcome,
  intent,
  tags,
  onDiscard,
}: {
  outcome: Extract<AssistOutcome, { kind: "bulk" }>;
  intent: string;
  tags: Tag[];
  onDiscard: () => void;
}) {
  const [drafted, setDrafted] = useState<{
    changeset: Changeset;
    scope: Scope;
  } | null>(null);
  const [drafting, setDrafting] = useState(false);

  const draft = useCallback(
    (scope: Scope) => {
      setDrafting(true);
      void draftFromScopeAction({
        scope,
        patch: outcome.patch,
        remove: outcome.remove,
        summary: outcome.summary,
      })
        .then((res) => {
          if (!res.ok) {
            toast.error(res.error);
            setDrafting(false);
            return;
          }
          if (res.data) setDrafted({ changeset: res.data, scope });
          setDrafting(false);
        })
        .catch(() => {
          toast.error("Could not build that draft");
          setDrafting(false);
        });
    },
    [outcome],
  );

  // Nothing assumed means the request was fully stated, so the screen would be
  // a click between somebody and the thing they asked for clearly.
  const skip = (outcome.scope.assumed ?? []).length === 0;
  useEffect(() => {
    if (skip) draft(outcome.scope);
  }, [skip, draft, outcome.scope]);

  if (drafted) {
    return (
      <ChangesetCanvas
        changeset={drafted.changeset}
        intent={intent}
        scope={describeScope(drafted.scope)}
        // Back to the criteria. The draft is thrown away rather than kept
        // alongside: two versions of the same change, one stale, is how
        // somebody applies the wrong one.
        onReopenScope={skip ? undefined : () => setDrafted(null)}
        onFlipMode={onDiscard}
        onDiscard={onDiscard}
      />
    );
  }

  if (skip || drafting) return <Thinking intent={intent} />;

  return (
    <ScopeScreen
      intent={intent}
      summary={outcome.summary}
      scope={outcome.scope}
      resolved={outcome.resolved}
      tags={tags}
      // A row already holding the value is selected and still changes
      // nothing, so the screen greys it and leaves it out of the count.
      willChange={(row) =>
        outcome.remove ||
        !outcome.patch.priority ||
        row.from !== outcome.patch.priority
      }
      patchLabel={(row) => {
        if (outcome.remove) return "remove";
        const to = outcome.patch.priority;
        if (to && row.from === to) return `already ${to}`;
        if (to && row.from) {
          return (
            <>
              <span className="line-through">{row.from}</span>
              <span className="px-1 text-faint2">&rarr;</span>
              {/* Inline, because the priority inks are raw CSS variables
                  rather than Tailwind colours — the same way PriorityChip
                  reads them. */}
              <span
                className="font-bold"
                style={{ color: `var(--prio-${to}-ink)` }}
              >
                {to}
              </span>
            </>
          );
        }
        return null;
      }}
      onDraft={draft}
      onCancel={onDiscard}
    />
  );
}
