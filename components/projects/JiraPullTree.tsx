"use client";

import type { JiraStage } from "@/lib/jira/issue";
import {
  epicTagName,
  type PullForest,
  type PullLevel,
  type PulledEpic,
  type PulledTicket,
} from "@/lib/jira/pull-plan";
import { tickOf, type Tick } from "@/lib/jira/pull-filter";
import { cn } from "@/lib/utils";

export const STAGE_DOT: Record<JiraStage, string> = {
  todo: "bg-faint",
  doing: "bg-notes",
  done: "bg-habits",
};

const label =
  "font-mono text-[10px] font-semibold uppercase tracking-widest text-faint2";

/** What the tree needs to know about each ticket, beyond what Jira said of it. */
export type PullMarks = {
  /** Unticked by hand, settled: a row with rows under it is in here only while it holds its own tick. */
  unticked: ReadonlySet<string>;
  /** Not drawn: the selectors left them out. */
  hidden: ReadonlySet<string>;
  /** Not brought in, for whichever reason. */
  off: ReadonlySet<string>;
  /** Cannot be ticked: hidden, or a task here already holds it. */
  skip: ReadonlySet<string>;
  have: { tasks: ReadonlySet<string>; projects: ReadonlySet<string> };
  /** Say which tickets are the owner's. Off where all of them are, or none can be told. */
  showMine: boolean;
};

/**
 * What a pull read, hung the way Jira hangs it (the ticket epics hang under,
 * then epic, then story), with a tick on every row. A row with rows under it
 * shows their ticks: all, none or some. A row the selectors left out is not
 * drawn at all.
 */
export function JiraPullTree({
  forest,
  level,
  marks,
  onToggle,
}: {
  forest: PullForest;
  level: PullLevel;
  marks: PullMarks;
  onToggle: (key: string) => void;
}) {
  const { unticked, hidden, off, have, skip } = marks;
  const tick = (key: string) => tickOf(forest, key, unticked, skip);
  const loose = forest.loose.filter((t) => !hidden.has(t.key));
  return (
    <div className="flex flex-col gap-0.5">
      {forest.coords.map((coord) => {
        if (hidden.has(coord.ticket.key)) return null;
        // Left out by its own tick: nothing under it comes in either.
        const coordOff = coord.epics.length > 0 && unticked.has(coord.ticket.key);
        return (
          <div key={coord.ticket.key}>
            <Row
              ticket={coord.ticket}
              depth={0}
              tick={tick(coord.ticket.key)}
              onToggle={onToggle}
              note={
                level !== "coord"
                  ? "not made"
                  : coord.epics.length > 0 && off.has(coord.ticket.key)
                    ? "nothing ticked under it"
                    : have.projects.has(coord.ticket.key)
                      ? "project, already here"
                      : "project"
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
                marks={marks}
                tick={tick}
                onToggle={onToggle}
              />
            ))}
          </div>
        );
      })}
      {forest.epics.map((epic) => (
        <EpicRows
          key={epic.ticket.key}
          epic={epic}
          depth={0}
          under={false}
          asTag={false}
          marks={marks}
          tick={tick}
          onToggle={onToggle}
        />
      ))}
      {loose.length > 0 && (
        <>
          <div className={cn(label, "px-1 pb-0.5 pt-2")}>Outside any project</div>
          {loose.map((t) => (
            <Row
              key={t.key}
              ticket={t}
              depth={0}
              tick={tick(t.key)}
              here={have.tasks.has(t.key)}
              mine={marks.showMine && t.mine}
              onToggle={onToggle}
            />
          ))}
        </>
      )}
    </div>
  );
}

function EpicRows({
  epic,
  depth,
  under,
  asTag,
  marks,
  tick,
  onToggle,
}: {
  epic: PulledEpic;
  depth: number;
  /** The ticket above this epic is left out, so nothing under it comes in. */
  under: boolean;
  /** The project is the ticket above, so this epic becomes a tag. */
  asTag: boolean;
  marks: PullMarks;
  tick: (key: string) => Tick;
  onToggle: (key: string) => void;
}) {
  const { unticked, hidden, off, have } = marks;
  if (hidden.has(epic.ticket.key)) return null;
  const epicOff = under || (epic.stories.length > 0 && unticked.has(epic.ticket.key));
  return (
    <>
      <Row
        ticket={epic.ticket}
        depth={depth}
        tick={tick(epic.ticket.key)}
        dimmed={under}
        onToggle={onToggle}
        note={
          epic.stories.length > 0 && off.has(epic.ticket.key)
            ? "nothing ticked under it"
            : asTag
              ? `tag #${epicTagName(epic.ticket.title, epic.ticket.key)}`
              : have.projects.has(epic.ticket.key)
                ? "project, already here"
                : "project"
        }
      />
      {epic.stories.map((story) =>
        hidden.has(story.key) ? null : (
          <Row
            key={story.key}
            ticket={story}
            depth={depth + 1}
            tick={tick(story.key)}
            dimmed={epicOff}
            here={have.tasks.has(story.key)}
            mine={marks.showMine && story.mine}
            onToggle={onToggle}
          />
        ),
      )}
    </>
  );
}

function Row({
  ticket,
  depth,
  tick,
  dimmed = false,
  here = false,
  mine = false,
  note,
  bold = false,
  onToggle,
}: {
  ticket: PulledTicket;
  depth: number;
  tick: Tick;
  /** A row above it is left out: it will not come in whatever its own box says. */
  dimmed?: boolean;
  /** A task here already holds this ticket. */
  here?: boolean;
  /** Assigned to the owner, and worth saying so. */
  mine?: boolean;
  note?: string;
  bold?: boolean;
  onToggle: (key: string) => void;
}) {
  const locked = dimmed || tick === "none";
  const out = locked || tick === "off";
  return (
    <label
      className={cn(
        "flex min-w-0 cursor-pointer items-center gap-2 rounded-md px-1 py-1 text-[12.5px] transition-colors hover:bg-hover",
        locked && "cursor-default",
      )}
      style={{ paddingLeft: 4 + depth * 18 }}
    >
      <input
        type="checkbox"
        checked={!dimmed && tick === "on"}
        // Some ticked under it: the box shows a dash, which only script can set.
        ref={(el) => {
          if (el) el.indeterminate = !dimmed && tick === "some";
        }}
        disabled={locked}
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
      {here || note ? (
        <span className="shrink-0 font-mono text-[10px] text-faint">
          {here ? "already here" : note}
        </span>
      ) : mine ? (
        <span className="shrink-0 font-mono text-[10px] font-semibold text-primary">
          you
        </span>
      ) : null}
    </label>
  );
}
