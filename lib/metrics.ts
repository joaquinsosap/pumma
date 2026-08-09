import type { Habit, HabitEntry, Task } from "@/lib/schemas";
import { iso } from "@/lib/date";

export function dayDonePercent(
  tasks: Task[],
  habits: Habit[],
  habitEntries: HabitEntry[],
  today: string = iso(),
): number {
  const todayTasks = tasks.filter((t) => (t.due ?? "").slice(0, 10) === today);
  const tasksDone = todayTasks.filter((t) => t.status === "done").length;
  const habitsDone = habits.filter((h) =>
    habitEntries.some((e) => e.habitId === h.id && e.date === today),
  ).length;
  const total = todayTasks.length + habits.length;
  if (!total) return 0;
  return Math.round(((tasksDone + habitsDone) / total) * 100);
}

export function projectProgress(
  projectId: string,
  tasks: Task[],
): { progress: number; label: string } {
  const linked = tasks.filter((t) => t.projectId === projectId);
  if (!linked.length) return { progress: 0, label: "0/0" };
  const done = linked.filter((t) => t.status === "done").length;
  return {
    progress: Math.round((done / linked.length) * 100),
    label: `${done}/${linked.length}`,
  };
}

export function tagCount(
  tagId: string,
  tasks: Task[],
  notes: { tagIds: string[] }[],
): number {
  return (
    tasks.filter((t) => t.tagIds.includes(tagId)).length +
    notes.filter((n) => n.tagIds.includes(tagId)).length
  );
}

export function tagsByUsage<T extends { id: string; name: string }>(
  tags: T[],
  tasks: Task[],
  notes: { tagIds: string[] }[],
): (T & { count: number })[] {
  return [...tags]
    .map((tag) => ({
      ...tag,
      count: tagCount(tag.id, tasks, notes),
    }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

export function openTaskCount(tasks: Task[]): number {
  return tasks.filter((t) => t.status !== "done").length;
}

export function habitsDoneToday(
  habits: Habit[],
  habitEntries: HabitEntry[],
  today: string = iso(),
): { done: number; total: number; label: string } {
  const done = habits.filter((h) =>
    habitEntries.some((e) => e.habitId === h.id && e.date === today),
  ).length;
  return { done, total: habits.length, label: `${done} / ${habits.length}` };
}

export function topStreak(
  habits: Habit[],
  habitEntries: HabitEntry[],
  streakFn: (dates: Set<string>, habit: Habit) => number,
): number {
  return Math.max(
    0,
    ...habits.map((h) => {
      const set = new Set(
        habitEntries.filter((e) => e.habitId === h.id).map((e) => e.date),
      );
      return streakFn(set, h);
    }),
  );
}
