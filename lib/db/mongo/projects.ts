import { getDb } from "@/lib/mongodb";
import {
  decryptAllFor,
  decryptFor,
  encryptFor,
} from "@/lib/db/mongo/encrypted";
import { newId } from "@/lib/store/memory";
import { toDto, type Project, projectSchema } from "@/lib/schemas";
import type { ProjectDoc, TaskDoc } from "@/lib/schemas";
import type { NewProjectDoc } from "@/lib/db/memory/projects";

async function col() {
  const db = await getDb();
  return db.collection<ProjectDoc>("projects");
}

export async function listProjects(userId: string): Promise<Project[]> {
  const c = await col();
  // createdAt desc approximates the memory store's unshift (newest first).
  const docs = await c.find({ userId }).sort({ createdAt: -1 }).toArray();
  const plain = await decryptAllFor("projects", userId, docs);
  return plain.map((p) => toDto(projectSchema.parse(p)));
}

export async function getProject(
  userId: string,
  id: string,
): Promise<Project | null> {
  const c = await col();
  const doc = await c.findOne({ _id: id, userId });
  if (!doc) return null;
  return toDto(projectSchema.parse(await decryptFor("projects", userId, doc)));
}

export async function insertProject(doc: NewProjectDoc): Promise<Project> {
  const c = await col();
  // A new project goes first in the hand-made order. Rows from before the
  // field existed sort lowest and read 0, which is the floor used here.
  let order = doc.order;
  if (order === undefined) {
    const first = await c
      .find({ userId: doc.userId }, { projection: { order: 1 } })
      .sort({ order: 1 })
      .limit(1)
      .next();
    order = Math.min(0, first?.order ?? 0) - 1;
  }
  const full = {
    updatedAt: new Date().toISOString(),
    ...doc,
    order,
    _id: doc._id ?? newId(),
  } as ProjectDoc;
  await c.insertOne(await encryptFor("projects", full.userId, full));
  return toDto(projectSchema.parse(full));
}

/** Every edit stamps the project. Reordering goes through reorderProjects, which does not. */
export async function updateProject(
  userId: string,
  id: string,
  patch: Partial<ProjectDoc>,
): Promise<Project | null> {
  const c = await col();
  const stamped = { updatedAt: new Date().toISOString(), ...patch };
  const doc = await c.findOneAndUpdate(
    { _id: id, userId },
    { $set: await encryptFor("projects", userId, stamped) },
    { returnDocument: "after" },
  );
  if (!doc) return null;
  return toDto(projectSchema.parse(await decryptFor("projects", userId, doc)));
}

/** Write the hand-made order in one round trip: the array is the arrangement. Ids that are not this user's match nothing. */
export async function reorderProjects(
  userId: string,
  ids: string[],
): Promise<number> {
  if (!ids.length) return 0;
  const c = await col();
  const res = await c.bulkWrite(
    ids.map((id, index) => ({
      updateOne: { filter: { _id: id, userId }, update: { $set: { order: index } } },
    })),
  );
  return res.matchedCount;
}

/** A task in this project changed in a way the task row cannot record (it was deleted or moved out). */
export async function touchProjects(
  userId: string,
  ids: string[],
): Promise<void> {
  const unique = [...new Set(ids)];
  if (!unique.length) return;
  const c = await col();
  await c.updateMany(
    { userId, _id: { $in: unique } },
    { $set: { updatedAt: new Date().toISOString() } },
  );
}

export async function deleteProject(
  userId: string,
  id: string,
  opts: { deleteTasks?: boolean } = {},
): Promise<boolean> {
  const c = await col();
  const db = await getDb();
  // Either take the project's tasks with it, or detach them — never leave a
  // dangling projectId (no transaction, sequential).
  if (opts.deleteTasks) {
    await db.collection<TaskDoc>("tasks").deleteMany({ userId, projectId: id });
  } else {
    await db
      .collection<TaskDoc>("tasks")
      .updateMany({ userId, projectId: id }, { $set: { projectId: null } });
  }
  const res = await c.deleteOne({ _id: id, userId });
  return res.deletedCount > 0;
}
