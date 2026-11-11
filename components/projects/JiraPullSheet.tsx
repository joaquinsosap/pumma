"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { JiraMark } from "@/components/icons";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { JiraPullTree, STAGE_DOT } from "@/components/projects/JiraPullTree";
import { useLifeView } from "@/components/shell/LifeAreaToggle";
import { hrefWithLife, viewShowing } from "@/lib/life-area";
import type { JiraStage } from "@/lib/jira/issue";
import {
  narrowPull,
  pullFilterStart,
  settleTicks,
  tickKeys,
  toggleTick,
  type PullFilter,
  type PullWho,
} from "@/lib/jira/pull-filter";
import { countPlan, planPull, type PullLevel } from "@/lib/jira/pull-plan";
import type { PullPreview, PullRun } from "@/lib/jira/pull-server";
import { ticketKeyFrom } from "@/lib/ticket-link";
import { cn } from "@/lib/utils";

type Source =
  | { kind: "ticket"; key: string; children: boolean }
  | { kind: "mine" };

type Shown = Extract<PullPreview, { state: "ok" }> & { source: Source };

/** The two ways in: one ticket by its number, or everything assigned to the owner. */
type Tab = "ticket" | "mine";

/** What one tab holds. Each keeps its own, so going to the other and back loses nothing. */
type Pane = {
  shown: Shown | null;
  /** Unticked by hand in the tree. */
  unticked: ReadonlySet<string>;
  filter: PullFilter;
  level: PullLevel;
  error: string | null;
};

const emptyPane = (): Pane => ({
  shown: null,
  unticked: new Set(),
  filter: pullFilterStart(),
  level: "coord",
  error: null,
});

/** A project already made from a ticket: one tap looks that ticket up again. */
export type JiraLookAgain = { key: string; title: string; color: string };

const label =
  "font-mono text-[10px] font-semibold uppercase tracking-widest text-faint2";

const TABS: { id: Tab; name: string }[] = [
  { id: "ticket", name: "A ticket" },
  { id: "mine", name: "Assigned to me" },
];

const STAGES: { id: JiraStage; name: string }[] = [
  { id: "todo", name: "To do" },
  { id: "doing", name: "In progress" },
  { id: "done", name: "Done" },
];

const NO_TICKS: ReadonlySet<string> = new Set();
const NO_JIRA = "Connect your Jira first: Settings, Connections, Jira.";

type Posted<T> = { ok: true; data: T } | { ok: false; said: string };

/**
 * Ask one of the pull routes. A refusal is told apart from a failure: "sign in
 * again" and "something broke halfway" call for different things, and the
 * second must not read as "nothing happened".
 */
async function post<T>(path: string, body: unknown, writes: boolean): Promise<Posted<T>> {
  let res: Response;
  try {
    res = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    return { ok: false, said: "PUMMA's server did not answer. Check your connection and try again." };
  }
  if (res.ok) {
    try {
      return { ok: true, data: (await res.json()) as T };
    } catch {
      return { ok: false, said: "PUMMA's server sent an answer that could not be read." };
    }
  }
  if (res.status === 401) return { ok: false, said: "You are signed out. Sign in and try again." };
  if (res.status === 403) return { ok: false, said: "This account cannot do that." };
  return {
    ok: false,
    said: writes
      ? "Something went wrong while bringing it in. Some of it may have come in: look again to see what is already here."
      : "Something went wrong on PUMMA's side. Try again.",
  };
}

/** "1 project, 2 tags, 3 tasks", leaving out what there is none of. */
function made(n: { projects: number; tags: number; tasks: number }): string {
  const parts = [
    [n.projects, "project"],
    [n.tags, "tag"],
    [n.tasks, "task"],
  ] as const;
  const said = parts
    .filter(([count]) => count > 0)
    .map(([count, word]) => `${count} ${word}${count === 1 ? "" : "s"}`);
  return said.join(", ");
}

/**
 * Bringing tickets in from Jira: name a ticket or take what is assigned to
 * you, look at what would come in, narrow it down, and bring it in.
 *
 * The two ways in are two tabs, and each keeps what it found. Nothing is made
 * until "Bring in". The selectors over the tree only narrow what was already
 * read, so changing one never asks Jira again, and the line at the bottom is
 * worked out by the same rule the server uses, so what it says is what happens.
 */
export function JiraPullSheet({
  open,
  onOpenChange,
  again = [],
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Projects here that came from a ticket, offered as shortcuts to look it up again. */
  again?: JiraLookAgain[];
}) {
  const router = useRouter();
  const [life] = useLifeView();
  const [tab, setTab] = useState<Tab>("ticket");
  const [panes, setPanes] = useState<Record<Tab, Pane>>(() => ({
    ticket: emptyPane(),
    mine: emptyPane(),
  }));
  const [number, setNumber] = useState("");
  const [children, setChildren] = useState(true);
  // One request at a time, and it belongs to the tab that asked: the other tab goes on showing what it has.
  const [busy, setBusy] = useState<{ doing: "read" | "bring"; tab: Tab } | null>(null);

  const pane = panes[tab];
  const { shown } = pane;
  const patch = (which: Tab, next: Partial<Pane>) =>
    setPanes((was) => ({ ...was, [which]: { ...was[which], ...next } }));

  const read = async (which: Tab, source: Source) => {
    if (busy) return;
    setBusy({ doing: "read", tab: which });
    patch(which, { error: null });
    const posted = await post<PullPreview>("/api/jira/pull", { source }, false);
    setBusy(null);
    if (!posted.ok) return patch(which, { error: posted.said });
    const res = posted.data;
    if (res.state === "no-connection") return patch(which, { error: NO_JIRA });
    if (res.state === "failed") return patch(which, { error: res.error });
    // The selectors stay as they were set: narrowing to your own tickets and
    // then looking at the next epic should not undo the narrowing.
    patch(which, { shown: { ...res, source }, unticked: new Set(), error: null });
  };

  const look = (text: string, under: boolean) => {
    const key = ticketKeyFrom(text);
    if (!key) {
      patch("ticket", { error: "Type a ticket number, like PROJ-123." });
      return;
    }
    void read("ticket", { kind: "ticket", key, children: under });
  };

  // Whose tickets only means something where they can differ and be told apart.
  const canPickWho = tab === "ticket" && (shown?.whoKnown ?? true);
  const filter = useMemo<PullFilter>(
    () => (canPickWho ? pane.filter : { ...pane.filter, who: "all" }),
    [canPickWho, pane.filter],
  );
  const have = useMemo(
    () => ({
      tasks: new Set(shown?.have.tasks ?? []),
      projects: new Set(shown?.have.projects ?? []),
    }),
    [shown],
  );
  // What the selectors hide does not depend on the ticks, so it is worked out
  // first: it decides which rows can be ticked at all.
  const hidden = useMemo(
    () => (shown ? narrowPull(shown.forest, filter, NO_TICKS).hidden : NO_TICKS),
    [shown, filter],
  );
  // What no click can tick: hidden by the selectors, or already a task here.
  const skip = useMemo(() => new Set([...hidden, ...have.tasks]), [hidden, have]);
  const unticked = useMemo(
    () => (shown ? settleTicks(shown.forest, pane.unticked, skip) : pane.unticked),
    [shown, pane.unticked, skip],
  );
  const narrowed = useMemo(
    () => (shown ? narrowPull(shown.forest, filter, unticked) : null),
    [shown, filter, unticked],
  );
  const plan = useMemo(
    () =>
      shown && narrowed
        ? planPull(shown.forest, pane.level, narrowed.off, have)
        : null,
    [shown, narrowed, pane.level, have],
  );
  const counts = plan ? countPlan(plan) : null;
  const nothing = !counts || counts.projects + counts.tags + counts.tasks === 0;

  const toggle = (key: string) => {
    if (!shown) return;
    patch(tab, { unticked: toggleTick(shown.forest, key, unticked, skip) });
  };

  const setWho = (who: PullWho) => patch(tab, { filter: { ...pane.filter, who } });
  const toggleStage = (stage: JiraStage) => {
    const stages = new Set(pane.filter.stages);
    if (stages.has(stage)) stages.delete(stage);
    else stages.add(stage);
    patch(tab, { filter: { ...pane.filter, stages } });
  };

  const bring = async () => {
    if (!shown || !narrowed || busy || nothing) return;
    const from = tab;
    setBusy({ doing: "bring", tab: from });
    patch(from, { error: null });
    const posted = await post<PullRun>(
      "/api/jira/pull/bring",
      {
        source: shown.source,
        level: pane.level,
        // The selectors as they are set and the ticks, not the list they add
        // up to: the server narrows its own read by the same rule.
        off: [...unticked],
        who: filter.who,
        stages: [...filter.stages],
      },
      true,
    );
    setBusy(null);
    // Whatever either tab shows was worked out against what was here before
    // this. Both read again, so neither goes on counting what just came in.
    const forget = (error: string | null) =>
      setPanes((was) => ({
        ticket: { ...was.ticket, shown: null, unticked: new Set(), error: null },
        mine: { ...was.mine, shown: null, unticked: new Set(), error: null },
        [from]: { ...was[from], shown: null, unticked: new Set(), error },
      }));
    if (!posted.ok) return forget(posted.said);
    const res = posted.data;
    if (res.state === "no-connection") return patch(from, { error: NO_JIRA });
    if (res.state === "failed") return patch(from, { error: res.error });
    const said = made(res.brought);
    toast.success(said ? `Brought in ${said}` : "Nothing new to bring in");
    forget(null);
    setNumber("");
    onOpenChange(false);
    // Go to the new project by its address, and only then refresh. Setting the
    // open project in place while the refresh runs throws the refresh away,
    // and the board would go on showing the list from before the pull.
    // Everything from Jira is work, so the link lands in a view that shows it.
    const id = res.brought.openProjectId;
    if (id) {
      router.push(
        hrefWithLife(`/projects?project=${id}`, viewShowing("work", life)),
      );
    }
    router.refresh();
  };

  /** This tab is the one waiting on Jira. */
  const reading = busy?.doing === "read" && busy.tab === tab;
  const forest = shown?.forest;
  const hasCoords = (forest?.coords.length ?? 0) > 0;
  const empty =
    forest &&
    forest.coords.length + forest.epics.length + forest.loose.length === 0;
  // Read, but the selectors leave none of it on screen.
  const allHidden =
    forest &&
    narrowed &&
    !empty &&
    [
      ...forest.coords.map((c) => c.ticket),
      ...forest.epics.map((e) => e.ticket),
      ...forest.loose,
    ].every((t) => narrowed.hidden.has(t.key));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[min(86dvh,760px)] max-w-2xl flex-col gap-4 p-5">
        <DialogTitle className="flex items-center gap-2 pr-8 text-[16px] font-bold leading-snug">
          <JiraMark className="h-4 w-4 shrink-0 text-jira" />
          Bring in from Jira
        </DialogTitle>

        <div
          role="tablist"
          aria-label="What to bring in"
          className="flex shrink-0 gap-0.5 rounded-[10px] bg-hover p-0.5"
        >
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              id={`jira-tab-${t.id}`}
              aria-selected={tab === t.id}
              aria-controls="jira-pane"
              onClick={() => setTab(t.id)}
              className={cn(
                "flex-1 rounded-lg px-3 py-1.5 text-[12.5px] font-semibold transition-colors",
                tab === t.id
                  ? "bg-surface text-ink shadow-sm"
                  : "text-muted hover:text-ink",
              )}
            >
              {t.name}
            </button>
          ))}
        </div>

        <div
          role="tabpanel"
          id="jira-pane"
          aria-labelledby={`jira-tab-${tab}`}
          className="flex min-h-0 flex-1 flex-col gap-4"
        >
          {tab === "ticket" ? (
            <div className="flex shrink-0 flex-col gap-2.5">
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  value={number}
                  disabled={busy !== null}
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="A ticket number, like PROJ-123"
                  aria-label="Ticket number"
                  onChange={(e) => setNumber(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") look(number, children);
                  }}
                  className="min-w-0 flex-1 font-mono"
                />
                <Button
                  onClick={() => look(number, children)}
                  disabled={busy !== null || !number.trim()}
                >
                  Look
                </Button>
              </div>
              <label className="flex cursor-pointer items-center gap-2 self-start text-[12.5px] text-muted">
                <Switch
                  checked={children}
                  onCheckedChange={setChildren}
                  disabled={busy !== null}
                  aria-label="Bring what is under it"
                />
                And what is under it
              </label>
              {again.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className={cn(label, "mr-0.5")}>Look again</span>
                  {again.map((p) => (
                    <button
                      key={p.key}
                      type="button"
                      disabled={busy !== null}
                      title={`Look ${p.key} up again`}
                      onClick={() => {
                        setNumber(p.key);
                        setChildren(true);
                        look(p.key, true);
                      }}
                      className="inline-flex max-w-[220px] items-center gap-1.5 rounded-lg border border-border bg-surface px-2 py-1 text-[12px] font-semibold text-ink transition-colors hover:border-faint2 disabled:opacity-50"
                    >
                      <span
                        aria-hidden
                        className="h-2 w-2 shrink-0 rounded-[2px]"
                        style={{ background: p.color }}
                      />
                      <span className="min-w-0 truncate">{p.title}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2">
              <Button
                variant={shown ? "outline" : "default"}
                onClick={() => void read("mine", { kind: "mine" })}
                disabled={busy !== null}
              >
                {shown ? "Fetch again" : "Fetch my tickets"}
              </Button>
              <span className="text-[12.5px] text-muted">
                Open tickets assigned to you, from every Jira project.
              </span>
            </div>
          )}

          {pane.error && (
            <p role="status" className="m-0 text-[12.5px] font-medium text-tasks">
              {pane.error}
            </p>
          )}

          {reading && (
            <p className="m-0 text-[12.5px] text-faint">Reading from Jira</p>
          )}

          {!shown && !reading && !pane.error && (
            <p className="m-0 text-[12.5px] leading-snug text-faint">
              {tab === "ticket"
                ? "A ticket that epics hang under comes in as a project, its epics as tags and their stories as tasks. An epic or a single ticket works too. Nothing is made until you press Bring in."
                : "Your tickets come in under the projects they belong to. Nothing is made until you press Bring in."}
            </p>
          )}

          {shown && forest && narrowed && !reading && (
            <>
              <div className="flex shrink-0 flex-wrap items-center gap-x-2 gap-y-1.5">
                {tab === "ticket" && (
                  <div
                    role="group"
                    aria-label="Whose tickets"
                    className="inline-flex gap-0.5 rounded-lg bg-hover p-0.5"
                  >
                    <WhoChip active={filter.who === "all"} onClick={() => setWho("all")}>
                      All
                    </WhoChip>
                    <WhoChip
                      active={filter.who === "mine"}
                      disabled={!canPickWho}
                      title={
                        canPickWho
                          ? undefined
                          : "Jira did not say who you are, so your tickets cannot be told apart."
                      }
                      onClick={() => setWho("mine")}
                    >
                      Assigned to me
                    </WhoChip>
                  </div>
                )}
                {STAGES.map((s) => {
                  const on = filter.stages.has(s.id);
                  return (
                    <button
                      key={s.id}
                      type="button"
                      aria-pressed={on}
                      onClick={() => toggleStage(s.id)}
                      className={cn(
                        "inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-0.5 text-[11.5px] font-semibold transition active:scale-[0.96]",
                        // Off is a flat tinted pill: the theme draws anything with a border colour as a raised control, on or off.
                        on
                          ? "border-border bg-surface text-ink"
                          : "border-transparent bg-hover text-muted hover:text-ink",
                      )}
                    >
                      <span
                        aria-hidden
                        className={cn(
                          "h-1.5 w-1.5 rounded-full",
                          STAGE_DOT[s.id],
                          !on && "opacity-40",
                        )}
                      />
                      {s.name}
                    </button>
                  );
                })}
                <span className="flex-1" />
                <TextButton onClick={() => patch(tab, { unticked: new Set() })}>
                  Tick all
                </TextButton>
                <TextButton
                  onClick={() => patch(tab, { unticked: new Set(tickKeys(forest, skip)) })}
                >
                  None
                </TextButton>
              </div>

              {hasCoords && (
                <div className="flex shrink-0 flex-wrap items-center gap-2">
                  <span className={label}>The project is</span>
                  <LevelChip
                    active={pane.level === "coord"}
                    onClick={() => patch(tab, { level: "coord" })}
                  >
                    The top ticket
                  </LevelChip>
                  <LevelChip
                    active={pane.level === "epic"}
                    onClick={() => patch(tab, { level: "epic" })}
                  >
                    Each epic
                  </LevelChip>
                </div>
              )}

              <div className="min-h-0 flex-1 overflow-y-auto rounded-lg border border-border bg-surface2/50 p-2.5">
                {empty ? (
                  <p className="m-0 p-2 text-[12.5px] text-faint">
                    Jira has nothing there to bring in.
                  </p>
                ) : allHidden ? (
                  <p className="m-0 p-2 text-[12.5px] text-faint">
                    Nothing matches. Turn a stage back on
                    {tab === "ticket" ? ", or pick All." : "."}
                  </p>
                ) : (
                  <JiraPullTree
                    forest={forest}
                    level={pane.level}
                    marks={{
                      unticked,
                      hidden: narrowed.hidden,
                      off: narrowed.off,
                      skip,
                      have,
                      showMine: canPickWho && filter.who === "all",
                    }}
                    onToggle={toggle}
                  />
                )}
              </div>

              {shown.capped && (
                <p className="m-0 shrink-0 text-[12px] text-faint">
                  Jira has more than fits in one go. Bring this in, then look
                  again for the rest.
                </p>
              )}

              <div className="flex shrink-0 flex-wrap items-center justify-between gap-3">
                <p className="m-0 text-[12.5px] text-muted" role="status">
                  {nothing || !counts
                    ? "Nothing new to bring in."
                    : `Makes ${made(counts)}.`}
                  {plan && plan.alreadyHere > 0
                    ? ` ${plan.alreadyHere} already here.`
                    : ""}
                </p>
                <Button onClick={() => void bring()} disabled={busy !== null || nothing}>
                  {busy?.doing === "bring" ? "Bringing in" : "Bring in"}
                </Button>
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function WhoChip({
  active,
  disabled = false,
  title,
  onClick,
  children,
}: {
  active: boolean;
  disabled?: boolean;
  title?: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      disabled={disabled}
      title={title}
      onClick={onClick}
      className={cn(
        "rounded-md px-2.5 py-1 text-[12px] font-semibold transition active:scale-[0.96] disabled:cursor-not-allowed disabled:opacity-50",
        active ? "bg-ink text-background" : "text-muted hover:text-ink",
      )}
    >
      {children}
    </button>
  );
}

function TextButton({
  onClick,
  children,
}: {
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-md border border-border bg-surface px-2 py-0.5 text-[11.5px] font-semibold text-ink transition active:scale-[0.96]"
    >
      {children}
    </button>
  );
}

function LevelChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "rounded-lg border px-2.5 py-1 text-[12px] font-semibold transition active:scale-[0.96]",
        active
          ? "border-transparent bg-ink text-background"
          : "border-transparent bg-hover text-muted hover:text-ink",
      )}
    >
      {children}
    </button>
  );
}
