import { describe, it, expect } from "vitest";
import { normalizeOps, type CurrentFields } from "@/lib/ai/normalize-changeset";
import type { ChangeOp } from "@/lib/ai/changeset-schema";

const TASK_ID = "aaaaaaaaaaaaaaaaaaaaaaaa";

const current = new Map<string, CurrentFields>([
  [
    TASK_ID,
    {
      title: "talk to facu about the work proposal",
      priority: "high",
      lifeArea: "personal",
      date: "2026-08-02",
      tagNames: ["personal"],
    },
  ],
  ["bbbbbbbbbbbbbbbbbbbbbbbb", { title: "Kitchen", lifeArea: "personal" }],
]);

const update = (fields: Record<string, unknown>): ChangeOp =>
  ({
    op: "update",
    entity: "task",
    id: TASK_ID,
    label: "talk to facu about the work proposal",
    fields,
    // What the model claimed — deliberately unreliable in these tests.
    before: {},
  }) as ChangeOp;

describe("echoed fields", () => {
  it("drops an operation whose every field matches what's already there", () => {
    // The real case: asked to file unfiled tasks, the model restated one
    // task's title, priority, life area, date and tags and changed nothing.
    const ops = normalizeOps(
      [
        update({
          title: "talk to facu about the work proposal",
          priority: "high",
          lifeArea: "personal",
          date: "2026-08-02",
          tagNames: ["personal"],
        }),
      ],
      current,
    );
    expect(ops).toHaveLength(0);
  });

  it("keeps the fields that genuinely change and strips the rest", () => {
    const ops = normalizeOps(
      [
        update({
          title: "talk to facu about the work proposal",
          priority: "high",
          projectId: "bbbbbbbbbbbbbbbbbbbbbbbb",
        }),
      ],
      current,
    );
    expect(ops).toHaveLength(1);
    const op = ops[0] as Extract<ChangeOp, { op: "update" }>;
    expect(Object.keys(op.fields)).toEqual(["projectId"]);
  });

  it("rewrites `before` from the database, not from what the model asserted", () => {
    const ops = normalizeOps([update({ priority: "low" })], current);
    const op = ops[0] as Extract<ChangeOp, { op: "update" }>;
    // The model sent before: {} — the truth is "high".
    expect(op.before.priority).toBe("high");
  });

  it("treats a timestamp and its date as the same day", () => {
    const ops = normalizeOps([update({ date: "2026-08-02T00:01" })], current);
    expect(ops).toHaveLength(0);
  });

  it("ignores tag order", () => {
    const withTags = new Map(current);
    withTags.set(TASK_ID, { ...current.get(TASK_ID)!, tagNames: ["a", "b"] });
    const ops = normalizeOps([update({ tagNames: ["b", "a"] })], withTags);
    expect(ops).toHaveLength(0);
  });
});

describe("everything else passes through", () => {
  it("leaves creates and deletes alone", () => {
    const ops = normalizeOps(
      [
        {
          op: "create",
          entity: "project",
          refId: "p1",
          fields: { title: "New" },
        },
        { op: "delete", entity: "habit", id: "zzz", label: "Old" },
      ] as ChangeOp[],
      current,
    );
    expect(ops).toHaveLength(2);
  });

  it("keeps an update whose target it has never heard of, for the stale check to flag", () => {
    const ops = normalizeOps(
      [
        {
          op: "update",
          entity: "task",
          id: "deadbeefdeadbeefdeadbeef",
          label: "Gone",
          fields: { priority: "high" },
          before: {},
        } as ChangeOp,
      ],
      current,
    );
    expect(ops).toHaveLength(1);
  });
});
