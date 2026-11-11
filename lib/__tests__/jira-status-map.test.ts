// Which Jira status is which column, what each column sends, and what a move asks of Jira.
import { describe, expect, it } from "vitest";
import {
  columnOfStatus,
  columnOfWith,
  emptyStatusMap,
  knownInOrder,
  planMove,
  readStatusMap,
  sendsAnything,
  ticketDiffers,
  withAnswer,
  withKnown,
  type JiraStatusMap,
} from "@/lib/jira/status-map";
import { planStatusSync } from "@/lib/jira/status-sync";

const map = (over: Partial<JiraStatusMap> = {}): JiraStatusMap => ({
  ...emptyStatusMap(),
  known: [
    { name: "Open", stage: "todo" },
    { name: "Blocked", stage: "doing" },
    { name: "In Progress", stage: "doing" },
    { name: "In Review", stage: "doing" },
    { name: "Closed", stage: "done" },
  ],
  ...over,
});

const sending = (to: Partial<JiraStatusMap["to"]>, over: Partial<JiraStatusMap> = {}) =>
  map({ to: { todo: null, doing: null, done: null, ...to }, ...over });

describe("where a Jira status lands", () => {
  it("follows Jira's sorting until he says otherwise", () => {
    expect(columnOfStatus(map(), "Blocked")).toBe("doing");
    expect(columnOfStatus(map({ from: { Blocked: "todo" } }), "Blocked")).toBe("todo");
  });

  it("takes the bucket Jira gives on a read over the one the tables last saw", () => {
    expect(columnOfStatus(map(), "Blocked", "todo")).toBe("todo");
  });

  it("keeps his answer over what Jira says on a read", () => {
    expect(columnOfStatus(map({ from: { Blocked: "todo" } }), "Blocked", "doing")).toBe("todo");
  });

  it("says nothing for a status nobody has sorted", () => {
    expect(columnOfStatus(map(), "Waiting")).toBeNull();
  });

  it("is what a read of Jira moves tasks by", () => {
    const changes = planStatusSync(
      [{ id: "t1", key: "PROJ-1", status: "doing", ticketStatus: "In Progress" }],
      new Map([["PROJ-1", { name: "Blocked", stage: "doing" as const, finished: null }]]),
      columnOfWith(map({ from: { Blocked: "todo" } })),
    );
    expect(changes[0].moveTo).toBe("todo");
  });
});

describe("his answers", () => {
  it("are kept only where they differ from Jira", () => {
    const set = withAnswer(map(), "In Review", "done");
    expect(set.from).toEqual({ "In Review": "done" });
    expect(withAnswer(set, "In Review", "doing").from).toEqual({});
  });
});

describe("the statuses the tables list", () => {
  it("gain what a read meets, once", () => {
    const next = withKnown(map(), [
      { name: "Waiting", stage: "doing" },
      { name: "Open", stage: "todo" },
    ]);
    expect(next?.known.map((k) => k.name)).toEqual([
      "Open",
      "Blocked",
      "In Progress",
      "In Review",
      "Closed",
      "Waiting",
    ]);
  });

  it("write nothing when a read meets only familiar ones", () => {
    expect(withKnown(map(), [{ name: "Open", stage: "todo" }])).toBeNull();
  });

  it("follow Jira when it sorts a status under another bucket", () => {
    const next = withKnown(map(), [{ name: "Blocked", stage: "todo" }]);
    expect(next?.known.find((k) => k.name === "Blocked")?.stage).toBe("todo");
  });

  it("show in board order", () => {
    const m = map({
      known: [
        { name: "Closed", stage: "done" },
        { name: "Odd", stage: null },
        { name: "Open", stage: "todo" },
        { name: "In Progress", stage: "doing" },
      ],
    });
    expect(knownInOrder(m).map((k) => k.name)).toEqual(["Open", "In Progress", "Closed", "Odd"]);
  });
});

describe("a stored map", () => {
  it("reads back as it was saved", () => {
    const m = sending({ doing: "In Progress" }, { from: { Blocked: "todo" } });
    expect(readStatusMap(JSON.parse(JSON.stringify(m)))).toEqual(m);
  });

  it("that is not a map reads as sending nothing", () => {
    const m = readStatusMap({ to: { doing: 12 } });
    expect(sendsAnything(m)).toBe(false);
    expect(readStatusMap("nonsense")).toEqual(emptyStatusMap());
  });

  it("lists a status once even when stored twice", () => {
    const m = readStatusMap({ known: [{ name: "Open", stage: "todo" }, { name: "Open", stage: "todo" }] });
    expect(m.known).toHaveLength(1);
  });

  it("starts sending nothing", () => {
    expect(sendsAnything(emptyStatusMap())).toBe(false);
    expect(sendsAnything(sending({ done: "Closed" }))).toBe(true);
  });
});

describe("a task that disagrees with its ticket", () => {
  const m = sending({ doing: "In Progress", done: "Closed" });

  it("is marked when its column sends and the ticket lands elsewhere", () => {
    expect(ticketDiffers(m, "done", "Open")).toBe(true);
  });

  it("is not marked when the ticket already lands in its column", () => {
    expect(ticketDiffers(m, "doing", "In Review")).toBe(false);
  });

  it("is not marked when its column leaves Jira alone", () => {
    expect(ticketDiffers(m, "todo", "Closed")).toBe(false);
  });

  it("is not marked before the ticket was ever read", () => {
    expect(ticketDiffers(m, "done", undefined)).toBe(false);
  });

  it("is not marked for a status nothing sorts", () => {
    expect(ticketDiffers(m, "done", "Waiting")).toBe(false);
  });
});

describe("what a move asks of Jira", () => {
  const m = sending({ doing: "In Progress", done: "Closed" });
  const offers = [
    { id: "11", to: "In Progress" },
    { id: "21", to: "Closed" },
  ];

  it("sends the move that leads to the status the column sends", () => {
    expect(planMove(m, "done", { name: "Open", stage: "todo" }, offers)).toEqual({
      kind: "send",
      transition: "21",
      status: "Closed",
    });
  });

  it("asks nothing when the column leaves Jira alone", () => {
    expect(planMove(m, "todo", { name: "Closed", stage: "done" }, offers)).toEqual({ kind: "off" });
  });

  it("leaves a ticket that already lands in the column where it is", () => {
    expect(planMove(m, "doing", { name: "In Review", stage: "doing" }, offers)).toEqual({
      kind: "already",
      status: "In Review",
    });
  });

  it("goes by his answer for where the ticket stands", () => {
    const mine = sending({ doing: "In Progress" }, { from: { Blocked: "todo" } });
    expect(planMove(mine, "doing", { name: "Blocked", stage: "doing" }, offers).kind).toBe("send");
  });

  it("says so when Jira offers no way there from where the ticket stands", () => {
    expect(planMove(m, "done", { name: "Open", stage: "todo" }, [offers[0]])).toEqual({
      kind: "not-allowed",
      from: "Open",
      status: "Closed",
    });
  });

  it("matches a status whatever its case", () => {
    expect(
      planMove(m, "done", { name: "Open", stage: "todo" }, [{ id: "31", to: "CLOSED" }]),
    ).toEqual({ kind: "send", transition: "31", status: "CLOSED" });
  });
});
