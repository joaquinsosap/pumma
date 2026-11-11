// What a move sent to Jira tells him, and when it keeps quiet.
import { describe, expect, it } from "vitest";
import { moveKept, moveSaid } from "@/lib/jira/move-said";

describe("after a move he made", () => {
  it("says the ticket moved", () => {
    expect(moveSaid({ state: "sent", key: "PROJ-12", status: "In Progress" }, false)).toEqual({
      tone: "good",
      text: "PROJ-12 is now In Progress in Jira",
    });
  });

  it("keeps quiet when the ticket was already where the column says", () => {
    expect(moveSaid({ state: "already", key: "PROJ-12", status: "In Review" }, false)).toBeNull();
  });

  it("keeps quiet when the column sends nothing", () => {
    expect(moveSaid({ state: "off" }, false)).toBeNull();
  });

  it("says why Jira would not take it", () => {
    expect(
      moveSaid({ state: "refused", key: "PROJ-31", error: "Jira does not let PROJ-31 go from Open to Closed." }, false),
    ).toEqual({ tone: "bad", text: "Jira does not let PROJ-31 go from Open to Closed." });
  });
});

describe("after Send to Jira", () => {
  it("says where the ticket already is", () => {
    expect(moveSaid({ state: "already", key: "PROJ-12", status: "In Review" }, true)?.text).toBe(
      "PROJ-12 is already In Review in Jira",
    );
  });

  it("says where to choose what a column sends", () => {
    expect(moveSaid({ state: "off" }, true)?.tone).toBe("plain");
  });
});

describe("what is kept on the task", () => {
  it("is Jira's answer whenever Jira was read", () => {
    expect(moveKept({ state: "sent", key: "P-1", status: "Done" })).toBe(true);
    expect(moveKept({ state: "refused", key: "P-1", error: "no" })).toBe(true);
    expect(moveKept({ state: "failed", error: "down" })).toBe(false);
  });
});
