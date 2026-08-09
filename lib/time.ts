export type TaskTimeFields = {
  timeSpentSec: number;
  timerStartedAt: string | null;
};

export function taskElapsedSec(
  task: TaskTimeFields,
  now: number = Date.now(),
): number {
  let total = task.timeSpentSec ?? 0;
  if (task.timerStartedAt) {
    const started = new Date(task.timerStartedAt).getTime();
    if (!Number.isNaN(started)) {
      total += Math.max(0, Math.floor((now - started) / 1000));
    }
  }
  return total;
}

export function formatDuration(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m`;
  return `${sec}s`;
}

export function formatDurationClock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  }
  return `${m}:${String(sec).padStart(2, "0")}`;
}

export function parseDurationInput(input: string): number | null {
  const s = input.trim().toLowerCase();
  if (!s) return 0;

  if (/^\d+$/.test(s)) return parseInt(s, 10) * 60;

  const colon = s.match(/^(\d+):(\d{2})(?::(\d{2}))?$/);
  if (colon) {
    if (colon[3]) {
      return (
        parseInt(colon[1], 10) * 3600 +
        parseInt(colon[2], 10) * 60 +
        parseInt(colon[3], 10)
      );
    }
    return parseInt(colon[1], 10) * 60 + parseInt(colon[2], 10);
  }

  let total = 0;
  const h = s.match(/(\d+)\s*h/);
  const m = s.match(/(\d+)\s*m(?:in)?/);
  const sec = s.match(/(\d+)\s*s(?:ec)?/);
  if (h) total += parseInt(h[1], 10) * 3600;
  if (m) total += parseInt(m[1], 10) * 60;
  if (sec) total += parseInt(sec[1], 10);
  if (h || m || sec) return total;

  return null;
}

export function secondsFromParts(hours: number, minutes: number): number {
  return Math.max(0, hours) * 3600 + Math.max(0, minutes) * 60;
}
