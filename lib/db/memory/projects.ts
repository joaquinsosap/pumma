import { getStore, newId } from "@/lib/store/memory";
import { toDto, type Project, projectSchema } from "@/lib/schemas";
import type { ProjectDoc } from "@/lib/schemas";

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

export async function insertProject(
  doc: Omit<ProjectDoc, "_id"> & { _id?: string },
): Promise<Project> {
  const store = getStore();
  const full = { ...doc, _id: doc._id ?? newId() };
  store.projects.unshift(full as ProjectDoc);
  return toDto(projectSchema.parse(full));
}

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
  store.projects[idx] = { ...store.projects[idx], ...patch };
  return toDto(projectSchema.parse(store.projects[idx]));
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
