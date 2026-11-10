"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { useLifeView } from "@/components/shell/LifeAreaToggle";
import { hrefWithLife, viewShowing } from "@/lib/life-area";
import type { JiraStage } from "@/lib/jira/issue";
import {
  countPlan,
  doneByDefault,
  epicTagName,
  planPull,
  type PullLevel,
  type PulledEpic,
  type PulledTicket,
} from "@/lib/jira/pull-plan";
import type { PullPreview, PullRun } from "@/lib/jira/pull-server";
import { ticketKeyFrom } from "@/lib/ticket-link";
import { cn } from "@/lib/utils";

type Source =
  | { kind: "ticket"; key: string; children: boolean }
  | { kind: "mine" };

type Shown = Extract<PullPreview, { state: "ok" }> & { source: Source };

const label =
  "font-mono text-[10px] font-semibold uppercase tracking-widest text-faint2";

const STAGE_DOT: Record<JiraStage, string> = {
  todo: "bg-faint",
  doing: "bg-notes",
  done: "bg-habits",
};

async function post<T>(path: string, body: unknown): Promise<T | null> {
  try {
    const res = await fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return res.ok ? ((await res.json()) as T) : null;
  } catch {
    return null;
  }
}

const NO_ANSWER = "PUMMA's server did not answer. Try again.";

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
 * you, look at what would come in, untick what should not, and bring it in.
 *
 * Nothing is made until "Bring in". The tree is Jira's own shape (the ticket
 * epics hang under, then epic, then story), and the line at the bottom is
 * worked out by the same rule the server uses, so what it says is what happens.
 */
export function JiraPullSheet({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const router = useRouter();
  const [life] = useLifeView();
  const [number, setNumber] = useState("");
  const [children, setChildren] = useState(true);
  const [busy, setBusy] = useState<"read" | "bring" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [shown, setShown] = useState<Shown | null>(null);
  const [level, setLevel] = useState<PullLevel>("coord");
  const [off, setOff] = useState<ReadonlySet<string>>(new Set());

  const read = async (source: Source) => {
    if (busy) return;
    setBusy("read");
    setError(null);
    const res = await post<PullPreview>("/api/jira/pull", { source });
    setBusy(null);
    if (!res) return setError(NO_ANSWER);
    if (res.state === "no-connection") {
      return setError("Connect your Jira first: Settings, Connections, Jira.");
    }
    if (res.state === "failed") return setError(res.error);
    setShown({ ...res, source });
    setOff(new Set(doneByDefault(res.forest)));
  };

  const readNumber = () => {
    const key = ticketKeyFrom(number);
    if (!key) {
      setError("Type a ticket number, like PROJ-123.");
      return;
    }
    void read({ kind: "ticket", key, children });
  };

  const have = useMemo(
    () => ({
      tasks: new Set(shown?.have.tasks ?? []),
      projects: new Set(shown?.have.projects ?? []),
    }),
    [shown],
  );
  const plan = useMemo(
    () => (shown ? planPull(shown.forest, level, off, have) : null),
    [shown, level, off, have],
  );
  const counts = plan ? countPlan(plan) : null;
  const nothing = !counts || counts.projects + counts.tags + counts.tasks === 0;

  const toggle = (key: string) =>
    setOff((was) => {
      const next = new Set(was);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const bring = async () => {
    if (!shown || busy || nothing) return;
    setBusy("bring");
    setError(null);
    const res = await post<PullRun>("/api/jira/pull/bring", {
      source: shown.source,
      level,
      off: [...off],
    });
    setBusy(null);
    if (!res) return setError(NO_ANSWER);
    if (res.state === "no-connection") {
      return setError("Connect your Jira first: Settings, Connections, Jira.");
    }
    if (res.state === "failed") return setError(res.error);
    const said = made(res.brought);
    toast.success(said ? `Brought in ${said}` : "Nothing new to bring in");
    setShown(null);
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

  const hasCoords = (shown?.forest.coords.length ?? 0) > 0;
  const empty =
    shown &&
    shown.forest.coords.length +
      shown.forest.epics.length +
      shown.forest.loose.length ===
      0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[min(86dvh,760px)] max-w-2xl flex-col gap-4 p-5">
        <DialogTitle className="pr-8 text-[16px] font-bold leading-snug">
          Bring in from Jira
        </DialogTitle>

        <div className="flex flex-col gap-2.5">
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
                if (e.key === "Enter") readNumber();
              }}
              className="min-w-0 flex-1 font-mono"
            />
            <Button onClick={readNumber} disabled={busy !== null || !number.trim()}>
              Look
            </Button>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
            <label className="flex cursor-pointer items-center gap-2 text-[12.5px] text-muted">
              <Switch
                checked={children}
                onCheckedChange={setChildren}
                disabled={busy !== null}
                aria-label="Bring what is under it"
              />
              And what is under it
            </label>
            <Button
              variant="outline"
              onClick={() => void read({ kind: "mine" })}
              disabled={busy !== null}
            >
              Tickets assigned to me
            </Button>
          </div>
        </div>

        {error && (
          <p role="status" className="m-0 text-[12.5px] font-medium text-tasks">
            {error}
          </p>
        )}

        {busy === "read" && (
          <p className="m-0 text-[12.5px] text-faint">Reading from Jira</p>
        )}

        {!shown && busy !== "read" && !error && (
          <p className="m-0 text-[12.5px] leading-snug text-faint">
            A ticket that epics hang under comes in as a project, its epics
            as tags and their stories as tasks. An epic or a single ticket
            works too. Nothing is made until you press Bring in.
          </p>
        )}

        {shown && busy !== "read" && (
          <>
            {hasCoords && (
              <div className="flex flex-wrap items-center gap-2">
                <span className={label}>The project is</span>
                <LevelChip active={level === "coord"} onClick={() => setLevel("coord")}>
                  The top ticket
                </LevelChip>
                <LevelChip active={level === "epic"} onClick={() => setLevel("epic")}>
                  Each epic
                </LevelChip>
              </div>
            )}

            <div className="min-h-0 flex-1 overflow-y-auto rounded-lg border border-border bg-surface2/50 p-2.5">
              {empty ? (
                <p className="m-0 p-2 text-[12.5px] text-faint">
                  Jira has nothing there to bring in.
                </p>
              ) : (
                <div className="flex flex-col gap-0.5">
                  {shown.forest.coords.map((coord) => {
                    const coordOff = off.has(coord.ticket.key);
                    return (
                      <div key={coord.ticket.key}>
                        <Row
                          ticket={coord.ticket}
                          depth={0}
                          off={coordOff}
                          onToggle={toggle}
                          note={
                            level === "coord"
                              ? have.projects.has(coord.ticket.key)
                                ? "project, already here"
                                : "project"
                              : "not made"
                          }
                          bold
                        />
                        {coord.epics.map((epic) => (
                          <EpicRows
                            key={epic.ticket.key}
                            epic={epic}
                            depth={1}
                            under={coordOff}
                            asTag={level === "coord"}
                            off={off}
                            have={have}
                            onToggle={toggle}
                          />
                        ))}
                      </div>
                    );
                  })}
                  {shown.forest.epics.map((epic) => (
                    <EpicRows
                      key={epic.ticket.key}
                      epic={epic}
                      depth={0}
                      under={false}
                      asTag={false}
                      off={off}
                      have={have}
                      onToggle={toggle}
                    />
                  ))}
                  {shown.forest.loose.length > 0 && (
                    <>
                      <div className={cn(label, "px-1 pb-0.5 pt-2")}>
                        Outside any project
                      </div>
                      {shown.forest.loose.map((t) => (
                        <Row
                          key={t.key}
                          ticket={t}
                          depth={0}
                          off={off.has(t.key)}
                          here={have.tasks.has(t.key)}
                          onToggle={toggle}
                        />
                      ))}
                    </>
                  )}
                </div>
              )}
            </div>

            {shown.capped && (
              <p className="m-0 text-[12px] text-faint">
                Jira has more than fits in one go. Bring this in, then look
                again for the rest.
              </p>
            )}

            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="m-0 text-[12.5px] text-muted" role="status">
                {nothing || !counts
                  ? "Nothing new to bring in."
                  : `Makes ${made(counts)}.`}
                {plan && plan.alreadyHere > 0
                  ? ` ${plan.alreadyHere} already here.`
                  : ""}
              </p>
              <Button onClick={() => void bring()} disabled={busy !== null || nothing}>
                {busy === "bring" ? "Bringing in" : "Bring in"}
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
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
        "rounded-lg border px-2.5 py-1 text-[12px] font-semibold transition-colors",
        active
          ? "border-transparent bg-ink text-background"
          : "border-transparent bg-hover text-muted hover:text-ink",
      )}
    >
      {children}
    </button>
  );
}

function EpicRows({
  epic,
  depth,
  under,
  asTag,
  off,
  have,
  onToggle,
}: {
  epic: PulledEpic;
  depth: number;
  /** The ticket above this epic is unticked, so nothing under it comes in. */
  under: boolean;
  /** The project is the COORD above, so this epic becomes a tag. */
  asTag: boolean;
  off: ReadonlySet<string>;
  have: { tasks: ReadonlySet<string>; projects: ReadonlySet<string> };
  onToggle: (key: string) => void;
}) {
  const epicOff = under || off.has(epic.ticket.key);
  return (
    <>
      <Row
        ticket={epic.ticket}
        depth={depth}
        off={off.has(epic.ticket.key)}
        dimmed={under}
        onToggle={onToggle}
        note={
          asTag
            ? `tag #${epicTagName(epic.ticket.title, epic.ticket.key)}`
            : have.projects.has(epic.ticket.key)
              ? "project, already here"
              : "project"
        }
      />
      {epic.stories.map((story) => (
        <Row
          key={story.key}
          ticket={story}
          depth={depth + 1}
          off={off.has(story.key)}
          dimmed={epicOff}
          here={have.tasks.has(story.key)}
          onToggle={onToggle}
        />
      ))}
    </>
  );
}

function Row({
  ticket,
  depth,
  off,
  dimmed = false,
  here = false,
  note,
  bold = false,
  onToggle,
}: {
  ticket: PulledTicket;
  depth: number;
  off: boolean;
  /** Something above it is unticked: it will not come in whatever its own tick says. */
  dimmed?: boolean;
  /** A task here already holds this ticket. */
  here?: boolean;
  note?: string;
  bold?: boolean;
  onToggle: (key: string) => void;
}) {
  const out = off || dimmed || here;
  return (
    <label
      className={cn(
        "flex min-w-0 cursor-pointer items-center gap-2 rounded-md px-1 py-1 text-[12.5px] hover:bg-hover",
        (dimmed || here) && "cursor-default",
      )}
      style={{ paddingLeft: 4 + depth * 18 }}
    >
      <input
        type="checkbox"
        checked={!off && !here}
        disabled={dimmed || here}
        onChange={() => onToggle(ticket.key)}
        className="h-3.5 w-3.5 shrink-0 accent-primary"
      />
      <span className="shrink-0 rounded-[5px] border border-border bg-surface px-1.5 font-mono text-[10px] font-semibold text-muted">
        {ticket.key}
      </span>
      {ticket.stage && (
        <span
          aria-hidden
          className={cn("h-1.5 w-1.5 shrink-0 rounded-full", STAGE_DOT[ticket.stage])}
        />
      )}
      <span
        className={cn(
          "min-w-0 flex-1 truncate",
          bold && "font-semibold",
          out ? "text-faint" : "text-ink",
        )}
      >
        {ticket.title}
      </span>
      {(here || note) && (
        <span className="shrink-0 font-mono text-[10px] text-faint">
          {here ? "already here" : note}
        </span>
      )}
    </label>
  );
}
