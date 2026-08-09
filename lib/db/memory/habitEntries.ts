import { getStore, newId } from "@/lib/store/memory";
import { toDto, type HabitEntry, habitEntrySchema } from "@/lib/schemas";

export async function listHabitEntries(userId: string): Promise<HabitEntry[]> {
  const store = getStore();
  return store.habitEntries
    .filter((e) => e.userId === userId)
    .map((e) => toDto(habitEntrySchema.parse(e)));
}

export async function toggleHabitEntry(
  userId: string,
  habitId: string,
  date: string,
): Promise<boolean> {
  const store = getStore();
  const existing = store.habitEntries.find(
    (e) => e.userId === userId && e.habitId === habitId && e.date === date,
  );
  if (existing) {
    store.habitEntries = store.habitEntries.filter(
      (e) => !(e.userId === userId && e.habitId === habitId && e.date === date),
    );
    return false;
  }
  store.habitEntries.push({
    _id: newId(),
    userId,
    habitId,
    date,
    done: true,
  });
  return true;
}

export async function habitEntriesInRange(
  userId: string,
  habitId: string,
  start: string,
  end: string,
): Promise<HabitEntry[]> {
  const store = getStore();
  return store.habitEntries
    .filter(
      (e) =>
        e.userId === userId &&
        e.habitId === habitId &&
        e.date >= start &&
        e.date <= end,
    )
    .map((e) => toDto(habitEntrySchema.parse(e)));
}

export async function clearHabitEntriesInRange(
  userId: string,
  habitId: string,
  start: string,
  end: string,
): Promise<number> {
  const store = getStore();
  const before = store.habitEntries.length;
  store.habitEntries = store.habitEntries.filter(
    (e) =>
      !(
        e.userId === userId &&
        e.habitId === habitId &&
        e.date >= start &&
        e.date <= end
      ),
  );
  return before - store.habitEntries.length;
}

export async function markHabitEntry(
  userId: string,
  habitId: string,
  date: string,
): Promise<void> {
  const store = getStore();
  const exists = store.habitEntries.some(
    (e) => e.userId === userId && e.habitId === habitId && e.date === date,
  );
  if (exists) return;
  store.habitEntries.push({ _id: newId(), userId, habitId, date, done: true });
}
