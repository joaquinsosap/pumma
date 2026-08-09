import { getDb } from "@/lib/mongodb";
import { toDto, type User, userSchema } from "@/lib/schemas";
import type { UserDoc } from "@/lib/schemas";

async function col() {
  const db = await getDb();
  return db.collection<UserDoc>("users");
}

export async function getUser(userId: string): Promise<User | null> {
  const c = await col();
  const doc = await c.findOne({ _id: userId });
  return doc ? toDto(userSchema.parse(doc)) : null;
}

/** Created once at signup (auth bootstrap). Idempotent. */
export async function insertUser(doc: UserDoc): Promise<User> {
  const c = await col();
  await c.updateOne({ _id: doc._id }, { $setOnInsert: doc }, { upsert: true });
  const saved = await c.findOne({ _id: doc._id });
  return toDto(userSchema.parse(saved));
}

export async function updateUser(
  userId: string,
  patch: Partial<Pick<UserDoc, "name" | "email">>,
): Promise<User | null> {
  const c = await col();
  const doc = await c.findOneAndUpdate(
    { _id: userId },
    { $set: patch },
    { returnDocument: "after" },
  );
  return doc ? toDto(userSchema.parse(doc)) : null;
}
