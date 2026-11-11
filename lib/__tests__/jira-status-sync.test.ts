// Which side moved, the ticket or the task, and where the task goes.
import { describe, expect, it } from "vitest";
import {
  nextWait,
  planStatusSync,
  seenLine,
  stepSeenFor,
  type LinkedTask,
  type TicketStatus,
} from "@/lib/jira/status-sync";

const task = (over: Partial<LinkedTask> = {}): LinkedTask => ({
  id: "t1",
  key: "PROJ-1",
  status: "todo",
  ticketStatus: "Open",
  ...over,
});

const step = (over: Partial<TicketStatus> = {}): TicketStatus => ({
  name: "Open",
  stage: "todo",
  finished: null,
  ...over,
});

const jira = (...pairs: [string, TicketStatus][]) => new Map(pairs);

describe("a ticket that moved in Jira", () => {
  it("takes its task along", () => {
    const changes = planStatusSync(
      [task()],
      jira(["PROJ-1", step({ name: "In Progress", stage: "doing" })]),
    );
    expect(changes).toEqual([
      { id: "t1", key: "PROJ-1", seen: "In Progress", moveTo: "doing", finished: null },
    ]);
  });

  it("carries the day Jira closed it when it lands in done", () => {
    const [change] = planStatusSync(
      [task({ status: "doing", ticketStatus: "In Progress" })],
      jira([
        "PROJ-1",
        step({ name: "Closed", stage: "done", finished: "2026-03-01T10:00:00.000Z" }),
      ]),
    );
    expect(change.moveTo).toBe("done");
    expect(change.finished).toBe("2026-03-01T10:00:00.000Z");
  });

  it("reopens a task that was done here", () => {
    const [change] = planStatusSync(
      [task({ status: "done", ticketStatus: "Closed" })],
      jira(["PROJ-1", step({ name: "Reopened", stage: "todo" })]),
    );
    expect(change.moveTo).toBe("todo");
    expect(change.finished).toBeNull();
  });

  it("only remembers the new step when the task is already in that column", () => {
    const changes = planStatusSync(
      [task({ status: "doing", ticketStatus: "In Progress" })],
      jira(["PROJ-1", step({ name: "In Review", stage: "doing" })]),
    );
    expect(changes).toEqual([
      { id: "t1", key: "PROJ-1", seen: "In Review", moveTo: null, finished: null },
    ]);
  });

  it("remembers a step no bucket claims, and leaves the task where it is", () => {
    const [change] = planStatusSync(
      [task()],
      jira(["PROJ-1", step({ name: "Parked", stage: null })]),
    );
    expect(change).toMatchObject({ seen: "Parked", moveTo: null });
  });
});

describe("a task that was moved here", () => {
  it("stays where it was put while Jira says what it said last time", () => {
    const changes = planStatusSync(
      [task({ status: "done", ticketStatus: "Open" })],
      jira(["PROJ-1", step({ name: "Open", stage: "todo" })]),
    );
    expect(changes).toEqual([]);
  });

  it("still follows the ticket once the ticket moves", () => {
    const [change] = planStatusSync(
      [task({ status: "done", ticketStatus: "Open" })],
      jira(["PROJ-1", step({ name: "In Progress", stage: "doing" })]),
    );
    expect(change.moveTo).toBe("doing");
  });
});

describe("a ticket never read before", () => {
  it("is taken at Jira's word once: closed there since it was brought in is done here", () => {
    const [change] = planStatusSync(
      [task({ ticketStatus: undefined })],
      jira(["PROJ-1", step({ name: "Closed", stage: "done" })]),
    );
    expect(change).toMatchObject({ seen: "Closed", moveTo: "done" });
  });

  it("gets its step remembered even when nothing moves", () => {
    const changes = planStatusSync(
      [task({ ticketStatus: null })],
      jira(["PROJ-1", step()]),
    );
    expect(changes).toEqual([
      { id: "t1", key: "PROJ-1", seen: "Open", moveTo: null, finished: null },
    ]);
  });
});

describe("what Jira did not hand back", () => {
  it("changes nothing: hidden from the token, or gone, is not a status", () => {
    expect(planStatusSync([task()], jira())).toEqual([]);
  });

  it("is told apart ticket by ticket", () => {
    const changes = planStatusSync(
      [task(), task({ id: "t2", key: "PROJ-2" })],
      jira(["PROJ-2", step({ name: "Done", stage: "done" })]),
    );
    expect(changes.map((c) => c.id)).toEqual(["t2"]);
  });
});

describe("another way of sorting steps into columns", () => {
  it("is asked instead of Jira's buckets", () => {
    const [change] = planStatusSync(
      [task()],
      jira(["PROJ-1", step({ name: "Blocked", stage: "doing" })]),
      (status) => (status.name === "Blocked" ? "todo" : status.stage),
    );
    expect(change).toMatchObject({ seen: "Blocked", moveTo: null });
  });
});

describe("what is kept on a task after a read", () => {
  it("gives the step back for the ticket it was read from", () => {
    expect(stepSeenFor("PROJ-12", seenLine("PROJ-12", "In Review"))).toBe("In Review");
  });

  it("is nothing for a task linked to another ticket since, so that one starts as never read", () => {
    expect(stepSeenFor("PROJ-2", seenLine("PROJ-1", "Done"))).toBeUndefined();
  });

  it("does not take PROJ-1's step for PROJ-12's", () => {
    expect(stepSeenFor("PROJ-1", seenLine("PROJ-12", "Done"))).toBeUndefined();
  });

  it("is nothing when nothing was kept", () => {
    expect(stepSeenFor("PROJ-1", null)).toBeUndefined();
    expect(stepSeenFor("PROJ-1", undefined)).toBeUndefined();
  });
});

describe("the wait before a project is read again", () => {
  it("falls inside the window, at either end and between", () => {
    expect(nextWait(600_000, 1_200_000, () => 0)).toBe(600_000);
    expect(nextWait(600_000, 1_200_000, () => 0.5)).toBe(900_000);
    expect(nextWait(600_000, 1_200_000, () => 0.999999)).toBeLessThanOrEqual(1_200_000);
  });

  it("is not the same every time", () => {
    const waits = new Set(
      Array.from({ length: 20 }, () => nextWait(600_000, 1_200_000)),
    );
    expect(waits.size).toBeGreaterThan(1);
  });
});

describe("somebody else's ticket", () => {
  it("puts its task back where Jira has it even when Jira did not change", () => {
    const changes = planStatusSync(
      [task({ status: "done", ticketStatus: "Open", mine: false })],
      jira(["PROJ-1", step({ mine: false })]),
    );
    expect(changes).toEqual([
      { id: "t1", key: "PROJ-1", seen: "Open", moveTo: "todo", finished: null },
    ]);
  });

  it("says so the first time a read learns it, and puts the task back", () => {
    const changes = planStatusSync(
      [task({ status: "doing", ticketStatus: "Open" })],
      jira(["PROJ-1", step({ mine: false })]),
    );
    expect(changes).toEqual([
      { id: "t1", key: "PROJ-1", seen: "Open", moveTo: "todo", finished: null, mine: false },
    ]);
  });

  it("changes nothing once the task already sits where Jira has it", () => {
    expect(
      planStatusSync(
        [task({ status: "todo", ticketStatus: "Open", mine: false })],
        jira(["PROJ-1", step({ mine: false })]),
      ),
    ).toEqual([]);
  });
});

describe("his own ticket", () => {
  it("keeps the column he put it in while Jira has not changed", () => {
    const changes = planStatusSync(
      [task({ status: "doing", ticketStatus: "Open", mine: true })],
      jira(["PROJ-1", step({ mine: true })]),
    );
    expect(changes).toEqual([]);
  });

  it("is marked his when a read learns it, without moving", () => {
    const changes = planStatusSync(
      [task({ status: "doing", ticketStatus: "Open" })],
      jira(["PROJ-1", step({ mine: true })]),
    );
    expect(changes).toEqual([
      { id: "t1", key: "PROJ-1", seen: "Open", moveTo: null, finished: null, mine: true },
    ]);
  });

  it("is not called anybody's when Jira would not say who he is", () => {
    expect(
      planStatusSync(
        [task({ status: "doing", ticketStatus: "Open" })],
        jira(["PROJ-1", step({ mine: null })]),
      ),
    ).toEqual([]);
  });
});

describe("a read that cannot tell whose a ticket is", () => {
  it("still puts back a task already known to be somebody else's", () => {
    const changes = planStatusSync(
      [task({ status: "done", ticketStatus: "Open", mine: false })],
      jira(["PROJ-1", step({ mine: null })]),
    );
    expect(changes).toEqual([
      { id: "t1", key: "PROJ-1", seen: "Open", moveTo: "todo", finished: null },
    ]);
  });
});
