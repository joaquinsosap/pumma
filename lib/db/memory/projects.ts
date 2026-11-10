import { getStore, newId } from "@/lib/store/memory";
import { toDto, type Project, projectSchema } from "@/lib/schemas";
import type { ProjectDoc } from "@/lib/schemas";

/** What insertProject accepts: the place in the order and the stamp are filled in when left out. */
export type NewProjectDoc = Omit<
  ProjectDoc,
  "_id" | "order" | "updatedAt" | "ticketUrl"
> & {
  _id?: string;
  order?: number;
  updatedAt?: string | null;
  ticketUrl?: string | null;
};

export async function listProjects(userId: string): Promise<Project[]> {
  const store = getStore();
  return store.projects
    .filter((p) => p.userId === userId)
    .map((p) => toDto(projectSchema.parse(p)));
}

export async function getProject(
  userId: string,
  id: string,
): Promise<Project | null> {
  const store = getStore();
  const doc = store.projects.find((p) => p._id === id && p.userId === userId);
  return doc ? toDto(projectSchema.parse(doc)) : null;
}

export async function insertProject(doc: NewProjectDoc): Promise<Project> {
  const store = getStore();
  // A new project goes first in the hand-made order.
  const orders = store.projects
    .filter((p) => p.userId === doc.userId)
    .map((p) => p.order ?? 0);
  const full = {
    order: Math.min(0, ...orders) - 1,
    updatedAt: new Date().toISOString(),
    ...doc,
    _id: doc._id ?? newId(),
  };
  store.projects.unshift(full as ProjectDoc);
  return toDto(projectSchema.parse(full));
}

/** Every edit stamps the project. Reordering goes through reorderProjects, which does not. */
export async function updateProject(
  userId: string,
  id: string,
  patch: Partial<ProjectDoc>,
): Promise<Project | null> {
  const store = getStore();
  const idx = store.projects.findIndex(
    (p) => p._id === id && p.userId === userId,
  );
  if (idx < 0) return null;
  store.projects[idx] = {
    ...store.projects[idx],
    updatedAt: new Date().toISOString(),
    ...patch,
  };
  return toDto(projectSchema.parse(store.projects[idx]));
}

/** Write the hand-made order: the array is the arrangement. Ids that are not this user's are skipped. */
export async function reorderProjects(
  userId: string,
  ids: string[],
): Promise<number> {
  const store = getStore();
  let written = 0;
  ids.forEach((id, index) => {
    const idx = store.projects.findIndex(
      (p) => p._id === id && p.userId === userId,
    );
    if (idx < 0) return;
    store.projects[idx] = { ...store.projects[idx], order: index };
    written++;
  });
  return written;
}

/** A task in this project changed in a way the task row cannot record (it was deleted or moved out). */
export async function touchProjects(
  userId: string,
  ids: string[],
): Promise<void> {
  const store = getStore();
  const now = new Date().toISOString();
  for (const id of new Set(ids)) {
    const idx = store.projects.findIndex(
      (p) => p._id === id && p.userId === userId,
    );
    if (idx >= 0) store.projects[idx] = { ...store.projects[idx], updatedAt: now };
  }
}

export async function deleteProject(
  userId: string,
  id: string,
  opts: { deleteTasks?: boolean } = {},
): Promise<boolean> {
  const store = getStore();
  const idx = store.projects.findIndex(
    (p) => p._id === id && p.userId === userId,
  );
  if (idx < 0) return false;
  if (opts.deleteTasks) {
    store.tasks = store.tasks.filter(
      (t) => !(t.userId === userId && t.projectId === id),
    );
  } else {
    for (const task of store.tasks) {
      if (task.userId === userId && task.projectId === id)
        task.projectId = null;
    }
  }
  store.projects.splice(idx, 1);
  return true;
}
