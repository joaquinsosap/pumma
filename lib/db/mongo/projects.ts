import { getDb } from "@/lib/mongodb";
import {
  decryptAllFor,
  decryptFor,
  encryptFor,
} from "@/lib/db/mongo/encrypted";
import { newId } from "@/lib/store/memory";
import { toDto, type Project, projectSchema } from "@/lib/schemas";
import type { ProjectDoc, TaskDoc } from "@/lib/schemas";

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

export async function insertProject(
  doc: Omit<ProjectDoc, "_id"> & { _id?: string },
): Promise<Project> {
  const c = await col();
  const full = { ...doc, _id: doc._id ?? newId() } as ProjectDoc;
  await c.insertOne(await encryptFor("projects", full.userId, full));
  return toDto(projectSchema.parse(full));
}

export async function updateProject(
  userId: string,
  id: string,
  patch: Partial<ProjectDoc>,
): Promise<Project | null> {
  const c = await col();
  const doc = await c.findOneAndUpdate(
    { _id: id, userId },
    { $set: await encryptFor("projects", userId, patch) },
    { returnDocument: "after" },
  );
  if (!doc) return null;
  return toDto(projectSchema.parse(await decryptFor("projects", userId, doc)));
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
