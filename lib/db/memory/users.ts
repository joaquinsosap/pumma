import { getStore } from "@/lib/store/memory";
import { toDto, type User, userSchema } from "@/lib/schemas";
import type { UserDoc } from "@/lib/schemas";

export async function getUser(userId: string): Promise<User | null> {
  const store = getStore();
  const doc = store.users.find((u) => u._id === userId);
  return doc ? toDto(userSchema.parse(doc)) : null;
}

/** Created once at signup (auth bootstrap). Idempotent. */
export async function insertUser(doc: UserDoc): Promise<User> {
  const store = getStore();
  const existing = store.users.find((u) => u._id === doc._id);
  if (existing) return toDto(userSchema.parse(existing));
  store.users.push(doc);
  return toDto(userSchema.parse(doc));
}

export async function updateUser(
  userId: string,
  patch: Partial<Pick<UserDoc, "name" | "email">>,
): Promise<User | null> {
  const store = getStore();
  const idx = store.users.findIndex((u) => u._id === userId);
  if (idx < 0) return null;
  store.users[idx] = { ...store.users[idx], ...patch };
  return toDto(userSchema.parse(store.users[idx]));
}
