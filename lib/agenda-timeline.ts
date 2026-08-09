import type { AgendaItem } from "@/lib/schemas";
import { formatTimeHM, parseTimeToMinutes } from "@/lib/date";

export type AgendaEventBlock = {
  type: "event";
  item: AgendaItem;
  startMins: number;
  endMins: number;
};

export type AgendaDeadBlock = {
  type: "dead";
  startMins: number;
  endMins: number;
  nextTitle: string;
  nextTime: string;
};

export type AgendaBlock = AgendaEventBlock | AgendaDeadBlock;

export type NowPlacement =
  | { kind: "before" }
  | { kind: "after" }
  | { kind: "event"; blockIndex: number; progress: number }
  | { kind: "dead"; blockIndex: number };

/**
 * Parse duration in minutes from agenda sub text, e.g. "30 min", "90 min block".
 * Only for legacy "routine" rows, which encoded the length in prose — real
 * meetings carry a `durationMins` field.
 */
export function parseAgendaDurationMins(sub: string): number | null {
  const m = sub.match(/(\d+)\s*min/i);
  return m ? parseInt(m[1], 10) : null;
}

export function eventEndMins(
  item: AgendaItem,
  nextStartMins: number | null,
): number {
  const start = parseTimeToMinutes(item.time);
  const parsed =
    item.kind === "meeting"
      ? item.durationMins
      : parseAgendaDurationMins(item.sub);
  if (parsed != null) return start + parsed;
  const defaultEnd = start + 30;
  if (nextStartMins != null && nextStartMins < defaultEnd) return nextStartMins;
  return defaultEnd;
}

export function buildAgendaBlocks(items: AgendaItem[]): AgendaBlock[] {
  const sorted = [...items].sort(
    (a, b) => parseTimeToMinutes(a.time) - parseTimeToMinutes(b.time),
  );
  const blocks: AgendaBlock[] = [];

  for (let i = 0; i < sorted.length; i++) {
    const item = sorted[i];
    const startMins = parseTimeToMinutes(item.time);
    const nextStart =
      i < sorted.length - 1 ? parseTimeToMinutes(sorted[i + 1].time) : null;
    const endMins = eventEndMins(item, nextStart);

    if (i > 0) {
      const prev = blocks[blocks.length - 1];
      const gapStart = prev.type === "event" ? prev.endMins : prev.endMins;
      const gapEnd = startMins;
      if (gapEnd - gapStart >= 5) {
        blocks.push({
          type: "dead",
          startMins: gapStart,
          endMins: gapEnd,
          nextTitle: item.title,
          nextTime: item.time,
        });
      }
    }

    blocks.push({ type: "event", item, startMins, endMins });
  }

  return blocks;
}

export function findNowPlacement(
  blocks: AgendaBlock[],
  nowMins: number = parseTimeToMinutes(formatTimeHM()),
): NowPlacement {
  if (!blocks.length) return { kind: "before" };

  const first = blocks.find((b) => b.type === "event") as
    | AgendaEventBlock
    | undefined;
  if (!first) return { kind: "before" };

  const lastEvent = [...blocks]
    .reverse()
    .find((b) => b.type === "event") as AgendaEventBlock;
  if (nowMins < first.startMins) return { kind: "before" };
  if (nowMins >= lastEvent.endMins) return { kind: "after" };

  for (let i = 0; i < blocks.length; i++) {
    const block = blocks[i];
    if (block.type === "event") {
      if (nowMins >= block.startMins && nowMins < block.endMins) {
        const span = Math.max(block.endMins - block.startMins, 1);
        return {
          kind: "event",
          blockIndex: i,
          progress: (nowMins - block.startMins) / span,
        };
      }
    } else if (nowMins >= block.startMins && nowMins < block.endMins) {
      return { kind: "dead", blockIndex: i };
    }
  }

  return { kind: "after" };
}

export function formatRemainingMinutes(totalMins: number): string {
  const m = Math.max(0, Math.ceil(totalMins));
  const h = Math.floor(m / 60);
  const min = m % 60;
  if (h > 0 && min > 0) return `${h}h ${min}m`;
  if (h > 0) return `${h}h`;
  return `${min}m`;
}

export function formatMinutesAsTime(mins: number): string {
  const h = Math.floor(mins / 60) % 24;
  const m = mins % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function formatDeadTimeLabel(
  startMins: number,
  endMins: number,
  active: boolean,
  remainingMins: number,
  nextTime: string,
): string {
  if (active) {
    return `${formatRemainingMinutes(remainingMins)} until ${nextTime}`;
  }
  return `${formatMinutesAsTime(startMins)} to ${formatMinutesAsTime(endMins)}`;
}
