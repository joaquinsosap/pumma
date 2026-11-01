// Every way of deleting a project takes its own tag with it, because a flagship pointing at nothing can't be deleted by hand.
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
  headers: async () => new Headers(),
}));

import { undoChangesetAction } from "@/lib/actions/changeset";
import { deleteProjectAction } from "@/lib/actions/projects";
import { insertProject } from "@/lib/db/memory/projects";
import { insertTag } from "@/lib/db/memory/tags";
import { applyDelete } from "@/lib/mutations/entities";
import { getCurrentUserId, getStore, resetStore } from "@/lib/store/memory";

const userId = getCurrentUserId();
const COLOR = "oklch(0.6 0.13 155)";

function makeProject(title: string) {
  return insertProject({
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
}

async function projectWithTags() {
  const project = await makeProject("Throwaway");
  const flagship = await insertTag(userId, "throwaway", {
    projectId: project.id,
    isProjectPrimary: true,
    color: COLOR,
  });
  const joined = await insertTag(userId, "joined", {
    projectId: project.id,
    isProjectPrimary: false,
    color: COLOR,
  });
  return { project, flagship: flagship!, joined: joined! };
}

const tagById = (id: string) => getStore().tags.find((t) => t._id === id);

describe("deleting a project", () => {
  beforeEach(() => {
    resetStore();
  });

  const expectReleased = ({
    flagship,
    joined,
  }: Awaited<ReturnType<typeof projectWithTags>>) => {
    expect(tagById(flagship.id)).toBeUndefined();
    expect(tagById(joined.id)).toBeDefined();
    expect(tagById(joined.id)?.projectId ?? null).toBeNull();
  };

  it("through a chat or the assistant", async () => {
    const made = await projectWithTags();
    await applyDelete(userId, "project", made.project.id, new Set());
    expectReleased(made);
  });

  it("from its panel", async () => {
    const made = await projectWithTags();
    expect((await deleteProjectAction(made.project.id)).ok).toBe(true);
    expectReleased(made);
  });

  it("by undoing the changeset that created it", async () => {
    const made = await projectWithTags();
    const res = await undoChangesetAction({
      created: [{ entity: "project", id: made.project.id }],
      updated: [],
    });
    expect(res.ok && res.data?.reverted).toBe(1);
    expectReleased(made);
  });

  it("leaves another project's tags alone", async () => {
    const made = await projectWithTags();
    const other = await makeProject("Other");
    const theirs = await insertTag(userId, "other", {
      projectId: other.id,
      isProjectPrimary: true,
      color: COLOR,
    });
    await applyDelete(userId, "project", made.project.id, new Set());
    expect(tagById(theirs!.id)?.projectId).toBe(other.id);
  });
});
