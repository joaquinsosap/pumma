// The assistant schema is sent as a tool input_schema, so the grammar caps
// (24 optionals / 16 unions) don't apply — but two other shapes do bite, and
// both cost a live round-trip to discover:
//   1. a tool's input_schema must be an object at the root
//   2. a model that sets one field must not be forced to emit the other eight
import { describe, it, expect } from "vitest";
import * as z from "zod/v4";
import { assistantResponseSchema } from "@/lib/ai/assistant-schema";

describe("the assistant schema as a tool input_schema", () => {
  it("is an object at the root", () => {
    const json = z.toJSONSchema(assistantResponseSchema, { io: "input" }) as {
      type?: string;
    };
    expect(json.type).toBe("object");
  });

  it("accepts an update that touches exactly one field", () => {
    // Precisely the payload that used to fail: "make my overdue tasks high
    // priority" sets priority and nothing else.
    const parsed = assistantResponseSchema.safeParse({
      response: {
        kind: "changeset",
        summary: "Raise priority",
        ops: [
          {
            op: "update",
            entity: "task",
            id: "7f5a39fec5f505891bad486b",
            label: "Send invoice",
            fields: { priority: "high" },
            before: { priority: "med" },
          },
        ],
      },
    });
    expect(parsed.success).toBe(true);
  });

  it("accepts a minimal create and a bare delete", () => {
    const parsed = assistantResponseSchema.safeParse({
      response: {
        kind: "changeset",
        summary: "Set up and clean up",
        ops: [
          {
            op: "create",
            entity: "project",
            refId: "p1",
            fields: { title: "Kitchen" },
          },
          { op: "delete", entity: "habit", id: "abc", label: "Old habit" },
        ],
      },
    });
    expect(parsed.success).toBe(true);
  });

  it("accepts an answer whose widgets omit their optional extras", () => {
    const parsed = assistantResponseSchema.safeParse({
      response: {
        kind: "answer",
        answer: "You have 7 open tasks.",
        widgets: [
          {
            type: "stat",
            title: "Open",
            span: "1",
            value: "7",
            label: "",
            hint: "",
          },
        ],
      },
    });
    expect(parsed.success).toBe(true);
  });
});
