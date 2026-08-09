import { getStore, newId } from "@/lib/store/memory";
import { toDto, type Habit, habitSchema } from "@/lib/schemas";
import type { HabitDoc } from "@/lib/schemas";

export async function listHabits(userId: string): Promise<Habit[]> {
  const store = getStore();
  return store.habits
    .filter((h) => h.userId === userId)
    .sort((a, b) => a.order - b.order)
    .map((h) => toDto(habitSchema.parse(h)));
}

export async function insertHabit(
  doc: Omit<HabitDoc, "_id"> & { _id?: string },
): Promise<Habit> {
  const store = getStore();
  const full = { ...doc, _id: doc._id ?? newId() };
  store.habits.push(full as HabitDoc);
  return toDto(habitSchema.parse(full));
}

export async function updateHabit(
  userId: string,
  id: string,
  patch: Partial<HabitDoc>,
): Promise<Habit | null> {
  const store = getStore();
  const idx = store.habits.findIndex(
    (h) => h._id === id && h.userId === userId,
  );
  if (idx < 0) return null;
  store.habits[idx] = { ...store.habits[idx], ...patch };
  return toDto(habitSchema.parse(store.habits[idx]));
}

export async function deleteHabit(
  userId: string,
  id: string,
): Promise<boolean> {
  const store = getStore();
  const idx = store.habits.findIndex(
    (h) => h._id === id && h.userId === userId,
  );
  if (idx < 0) return false;
  store.habitEntries = store.habitEntries.filter((e) => e.habitId !== id);
  store.habits.splice(idx, 1);
  return true;
}

export async function updateHabitsOrder(
  userId: string,
  ids: string[],
): Promise<void> {
  const store = getStore();
  ids.forEach((id, order) => {
    const idx = store.habits.findIndex(
      (h) => h._id === id && h.userId === userId,
    );
    if (idx >= 0) store.habits[idx] = { ...store.habits[idx], order };
  });
}
