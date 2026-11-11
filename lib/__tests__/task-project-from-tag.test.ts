// A task made for the user by an assistant lands in a project when it carries that project's tag, named or not.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
  headers: async () => new Headers(),
}));

import { insertProject } from "@/lib/db/memory/projects";
import { insertTag, listTags } from "@/lib/db/memory/tags";
import { applyCreate, resolveExisting, type Ctx } from "@/lib/mutations/entities";
import { getCurrentUserId, getStore, resetStore } from "@/lib/store/memory";

const userId = getCurrentUserId();
const COLOR = "oklch(0.6 0.13 155)";

async function projectWithTag(title: string, tag: string) {
  const project = await insertProject({
    userId,
    title,
    description: "",
    color: COLOR,
    progress: 0,
    label: "0/0",
    goalId: null,
    tagIds: [],
    lifeArea: "personal",
    createdAt: "2026-07-18",
  });
  const flagship = await insertTag(userId, tag, {
    projectId: project.id,
    isProjectPrimary: true,
    color: COLOR,
  });
  return { project, flagship: flagship! };
}

async function makeTask(fields: { projectId?: string; tagNames?: string[] }) {
  const ctx: Ctx = {
    td: "2026-11-11",
    tags: await listTags(userId),
    resolve: resolveExisting,
    touchedProjects: new Set<string>(),
  };
  const made = await applyCreate(
    userId,
    {
      op: "create",
      entity: "task",
      refId: "new-task",
      fields: { title: "Ship it", ...fields },
    },
    ctx,
  );
  const task = getStore().tasks.find((t) => t._id === made!.id)!;
  return { task, ctx };
}

describe("a task made with a project's tag", () => {
  beforeEach(() => {
    resetStore();
  });

  it("lands in that project when no project was named", async () => {
    const { project, flagship } = await projectWithTag("Website", "website");
    const { task, ctx } = await makeTask({ tagNames: ["website"] });
    expect(task.projectId).toBe(project.id);
    expect(task.tagIds).toContain(flagship.id);
    expect(ctx.touchedProjects.has(project.id)).toBe(true);
  });

  it("stays outside every project when none of its tags is a project's", async () => {
    await projectWithTag("Website", "website");
    const { task } = await makeTask({ tagNames: ["errands"] });
    expect(task.projectId).toBeNull();
  });

  it("goes to the last project tagged when two are, and keeps only that one's tag", async () => {
    const web = await projectWithTag("Website", "website");
    const app = await projectWithTag("App", "app");
    const { task } = await makeTask({ tagNames: ["website", "app"] });
    expect(task.projectId).toBe(app.project.id);
    expect(task.tagIds).toContain(app.flagship.id);
    expect(task.tagIds).not.toContain(web.flagship.id);
  });

  it("stays outside when the tag's project no longer exists", async () => {
    const { project } = await projectWithTag("Website", "website");
    const projects = getStore().projects;
    projects.splice(
      projects.findIndex((p) => p._id === project.id),
      1,
    );
    const { task, ctx } = await makeTask({ tagNames: ["website"] });
    expect(task.projectId).toBeNull();
    expect(ctx.touchedProjects.size).toBe(0);
  });

  it("goes to the project that was named, and drops another project's tag", async () => {
    const web = await projectWithTag("Website", "website");
    const app = await projectWithTag("App", "app");
    const { task } = await makeTask({
      projectId: app.project.id,
      tagNames: ["website"],
    });
    expect(task.projectId).toBe(app.project.id);
    expect(task.tagIds).toContain(app.flagship.id);
    expect(task.tagIds).not.toContain(web.flagship.id);
  });
});
