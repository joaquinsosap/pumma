// A task in a project wears the project's own tag, whichever of the project's tags put it there.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
  headers: async () => new Headers(),
}));

import { attachTagToProjectAction } from "@/lib/actions/projects";
import { toggleEntityTag } from "@/lib/actions/tags";
import { createFromOmni } from "@/lib/actions/tasks";
import { insertProject } from "@/lib/db/memory/projects";
import { insertTag } from "@/lib/db/memory/tags";
import { getCurrentUserId, getStore, resetStore } from "@/lib/store/memory";

const userId = getCurrentUserId();
const COLOR = "oklch(0.6 0.13 155)";

async function entertainment() {
  const project = await insertProject({
    userId,
    title: "Entertainment",
    description: "",
    color: COLOR,
    progress: 0,
    label: "0/0",
    goalId: null,
    tagIds: [],
    lifeArea: "personal",
    createdAt: "2026-07-18",
  });
  const own = await insertTag(userId, "entertainment", {
    projectId: project.id,
    isProjectPrimary: true,
    color: COLOR,
  });
  return { project, own: own! };
}

const extraTag = async (name: string, projectId: string | null) =>
  (await insertTag(userId, name, {
    projectId,
    isProjectPrimary: false,
    color: COLOR,
  }))!;

const taskNamed = (title: string) =>
  getStore().tasks.find((t) => t.title === title)!;

describe("a task in a project wears the project's own tag", () => {
  beforeEach(() => {
    resetStore();
  });

  it("when captured with one of the project's other tags", async () => {
    const { project, own } = await entertainment();
    const anime = await extraTag("anime", project.id);

    const res = await createFromOmni({
      text: "watch the samurai show #anime",
      type: "task",
    });
    expect(res.ok).toBe(true);

    const task = taskNamed("watch the samurai show");
    expect(task.projectId).toBe(project.id);
    expect(task.tagIds).toContain(anime.id);
    expect(task.tagIds).toContain(own.id);
  });

  it("when a tag it already carries joins the project", async () => {
    const { project, own } = await entertainment();
    const book = await extraTag("book", null);
    await createFromOmni({ text: "read the meaning book #book", type: "task" });
    expect(taskNamed("read the meaning book").projectId).toBeNull();

    const res = await attachTagToProjectAction({
      projectId: project.id,
      tagId: book.id,
    });
    expect(res.ok && res.data?.filed).toBe(1);

    const task = taskNamed("read the meaning book");
    expect(task.projectId).toBe(project.id);
    expect(task.tagIds).toContain(own.id);
  });

  it("when one of the project's other tags is put on it by hand", async () => {
    const { project, own } = await entertainment();
    const anime = await extraTag("anime", project.id);
    await createFromOmni({ text: "an unfiled thing", type: "task" });
    const before = taskNamed("an unfiled thing");
    expect(before.projectId).toBeNull();

    const res = await toggleEntityTag("task", before._id, anime.id, true);
    expect(res.ok).toBe(true);

    const task = taskNamed("an unfiled thing");
    expect(task.projectId).toBe(project.id);
    expect(task.tagIds).toContain(own.id);
  });
});
