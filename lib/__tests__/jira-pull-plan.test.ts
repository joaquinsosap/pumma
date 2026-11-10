// What a pull from Jira would make here: which level is the project, what the epics become, and what is left out.
import { describe, expect, it } from "vitest";
import {
  EPIC_TAG_MAX,
  countPlan,
  doneByDefault,
  epicTagName,
  planPull,
  type PullForest,
  type PulledTicket,
} from "@/lib/jira/pull-plan";

const ticket = (
  key: string,
  title: string,
  stage: PulledTicket["stage"] = "todo",
): PulledTicket => ({
  key,
  title,
  stage,
  url: `https://desk.example.com/browse/${key}`,
});

const COORD = ticket("COOR-12", "Platform alerts");
const QUEUE = ticket("VST-210", "Queue alerts");
const BOARDS = ticket("VST-214", "Dashboards");
const RULES = ticket("VST-221", "Alert rules for the queue", "doing");
const RUNBOOK = ticket("VST-222", "Write the runbook");
const LATENCY = ticket("VST-230", "Latency board", "done");

const forest = (): PullForest => ({
  coords: [
    {
      ticket: COORD,
      epics: [
        { ticket: QUEUE, stories: [RULES, RUNBOOK] },
        { ticket: BOARDS, stories: [LATENCY] },
      ],
    },
  ],
  epics: [],
  loose: [],
});

const NONE: ReadonlySet<string> = new Set();
const NOTHING = { tasks: NONE, projects: NONE };
const haveTasks = (...keys: string[]) => ({ tasks: new Set(keys), projects: NONE });

describe("planPull, with the COORD as the project", () => {
  it("makes one project, a tag per epic, and a task per story wearing its epic's tag", () => {
    const plan = planPull(forest(), "coord", NONE, NOTHING);
    expect(plan.projects).toHaveLength(1);
    const [project] = plan.projects;
    expect(project.from).toEqual(COORD);
    expect(project.title).toBe("Platform alerts");
    expect(project.tags).toEqual(["queue-alerts", "dashboards"]);
    expect(project.tasks).toEqual([
      { title: "Alert rules for the queue", ticketUrl: RULES.url, status: "doing", tag: "queue-alerts" },
      { title: "Write the runbook", ticketUrl: RUNBOOK.url, status: "todo", tag: "queue-alerts" },
      { title: "Latency board", ticketUrl: LATENCY.url, status: "done", tag: "dashboards" },
    ]);
    expect(countPlan(plan)).toEqual({ projects: 1, tags: 2, tasks: 3 });
  });

  it("gives two epics cut to the same words different tags", () => {
    const twins = forest();
    twins.coords[0].epics = [
      { ticket: ticket("VST-1", "Queue alerts"), stories: [RULES] },
      { ticket: ticket("VST-2", "Queue alerts!"), stories: [RUNBOOK] },
    ];
    const [project] = planPull(twins, "coord", NONE, NOTHING).projects;
    expect(project.tags).toEqual(["queue-alerts", "queue-alerts-2"]);
    expect(project.tasks.map((t) => t.tag)).toEqual(["queue-alerts", "queue-alerts-2"]);
  });

  it("makes a project of an epic that has no COORD above it, with no epic tag", () => {
    const orphan: PullForest = {
      coords: [],
      epics: [{ ticket: QUEUE, stories: [RULES] }],
      loose: [],
    };
    const plan = planPull(orphan, "coord", NONE, NOTHING);
    expect(plan.projects).toEqual([
      {
        from: QUEUE,
        existing: false,
        title: "Queue alerts",
        tags: [],
        tasks: [{ title: RULES.title, ticketUrl: RULES.url, status: "doing", tag: null }],
      },
    ]);
  });
});

describe("planPull, with each epic as a project", () => {
  it("makes a project per epic, no epic tags, and nothing of the COORD itself", () => {
    const plan = planPull(forest(), "epic", NONE, NOTHING);
    expect(plan.projects.map((p) => p.title)).toEqual(["Queue alerts", "Dashboards"]);
    expect(plan.projects.every((p) => p.tags.length === 0)).toBe(true);
    expect(plan.projects.flatMap((p) => p.tasks).every((t) => t.tag === null)).toBe(true);
    expect(countPlan(plan)).toEqual({ projects: 2, tags: 0, tasks: 3 });
  });
});

describe("planPull, leaving things out", () => {
  it("drops an unticked story and nothing else", () => {
    const plan = planPull(forest(), "coord", new Set([RUNBOOK.key]), NOTHING);
    expect(plan.projects[0].tasks.map((t) => t.ticketUrl)).toEqual([RULES.url, LATENCY.url]);
    expect(plan.projects[0].tags).toEqual(["queue-alerts", "dashboards"]);
  });

  it("drops an unticked epic with its tag and everything under it", () => {
    const plan = planPull(forest(), "coord", new Set([QUEUE.key]), NOTHING);
    expect(plan.projects[0].tags).toEqual(["dashboards"]);
    expect(plan.projects[0].tasks.map((t) => t.ticketUrl)).toEqual([LATENCY.url]);
  });

  it("makes nothing of an unticked COORD, at either level", () => {
    const off = new Set([COORD.key]);
    expect(planPull(forest(), "coord", off, NOTHING).projects).toEqual([]);
    expect(planPull(forest(), "epic", off, NOTHING).projects).toEqual([]);
  });

  it("never makes a ticket twice: one a task already links is counted, not made", () => {
    const plan = planPull(forest(), "coord", NONE, haveTasks(RULES.key));
    expect(plan.alreadyHere).toBe(1);
    expect(plan.projects[0].tasks.map((t) => t.ticketUrl)).toEqual([RUNBOOK.url, LATENCY.url]);
    // The epic's tag is still planned: the task already here may want it.
    expect(plan.projects[0].tags).toContain("queue-alerts");
  });

  it("knows a ticket by its number, however the task here links it", () => {
    // The caller hands over numbers, so a board link or a filter link to VST-221 counts the same.
    const plan = planPull(forest(), "coord", NONE, haveTasks("VST-221", "VST-222", "VST-230"));
    expect(plan.alreadyHere).toBe(3);
    expect(plan.projects[0].tasks).toEqual([]);
  });

  it("makes a ticket once when the read named it twice", () => {
    const twice = forest();
    twice.coords[0].epics[1].stories.push(RULES);
    const tasks = planPull(twice, "coord", NONE, NOTHING).projects[0].tasks;
    expect(tasks.filter((t) => t.ticketUrl === RULES.url)).toHaveLength(1);
  });

  it("does not count an unticked ticket as already here", () => {
    const plan = planPull(forest(), "coord", new Set([RULES.key]), haveTasks(RULES.key));
    expect(plan.alreadyHere).toBe(0);
  });
});

describe("planPull, a second pull of the same thing", () => {
  it("adds to the project already made from that COORD, and counts no new project", () => {
    const have = { tasks: new Set([RULES.key, RUNBOOK.key]), projects: new Set([COORD.key]) };
    const plan = planPull(forest(), "coord", NONE, have);
    expect(plan.projects).toHaveLength(1);
    expect(plan.projects[0].existing).toBe(true);
    expect(plan.projects[0].from).toEqual(COORD);
    expect(plan.projects[0].tasks.map((t) => t.ticketUrl)).toEqual([LATENCY.url]);
    expect(plan.alreadyHere).toBe(2);
    expect(countPlan(plan)).toEqual({ projects: 0, tags: 2, tasks: 1 });
  });

  it("does the same per epic when each epic is the project", () => {
    const have = { tasks: NONE, projects: new Set([QUEUE.key]) };
    const plan = planPull(forest(), "epic", NONE, have);
    expect(plan.projects.map((p) => [p.from?.key, p.existing])).toEqual([
      ["VST-210", true],
      ["VST-214", false],
    ]);
    expect(countPlan(plan).projects).toBe(1);
  });

  it("makes nothing new at all when everything is already here", () => {
    const have = {
      tasks: new Set([RULES.key, RUNBOOK.key, LATENCY.key]),
      projects: new Set([COORD.key]),
    };
    const plan = planPull(forest(), "coord", NONE, have);
    expect(countPlan(plan)).toMatchObject({ projects: 0, tasks: 0 });
    expect(plan.alreadyHere).toBe(3);
  });
});

describe("planPull, tickets with nothing above them", () => {
  it("makes them tasks outside any project, and counts no project for them", () => {
    const flat: PullForest = { coords: [], epics: [], loose: [RULES, RUNBOOK] };
    const plan = planPull(flat, "coord", NONE, NOTHING);
    expect(plan.projects).toEqual([
      {
        from: null,
        existing: false,
        title: null,
        tags: [],
        tasks: [
          { title: RULES.title, ticketUrl: RULES.url, status: "doing", tag: null },
          { title: RUNBOOK.title, ticketUrl: RUNBOOK.url, status: "todo", tag: null },
        ],
      },
    ]);
    expect(countPlan(plan)).toEqual({ projects: 0, tags: 0, tasks: 2 });
  });

  it("plans nothing at all when every loose ticket is left out", () => {
    const flat: PullForest = { coords: [], epics: [], loose: [RULES] };
    expect(planPull(flat, "coord", new Set([RULES.key]), NOTHING).projects).toEqual([]);
  });
});

describe("planPull, what Jira did not say", () => {
  it("starts a ticket with no known stage in To do", () => {
    const unknown: PullForest = { coords: [], epics: [], loose: [ticket("VST-9", "Mystery", null)] };
    expect(planPull(unknown, "coord", NONE, NOTHING).projects[0].tasks[0].status).toBe("todo");
  });

  it("names a ticket with a blank title by its number, and caps the long ones", () => {
    const odd: PullForest = {
      coords: [{ ticket: ticket("COOR-1", "   "), epics: [{ ticket: ticket("VST-1", "E"), stories: [ticket("VST-2", "  "), ticket("VST-3", "x".repeat(500))] }] }],
      epics: [],
      loose: [],
    };
    const [project] = planPull(odd, "coord", NONE, NOTHING).projects;
    expect(project.title).toBe("COOR-1");
    expect(project.tasks[0].title).toBe("VST-2");
    expect(project.tasks[1].title.length).toBe(200);
    const long = planPull(
      { coords: [], epics: [{ ticket: ticket("VST-4", "y".repeat(500)), stories: [] }], loose: [] },
      "epic",
      NONE,
      NOTHING,
    );
    expect(long.projects[0].title?.length).toBe(120);
  });
});

describe("epicTagName", () => {
  it("keeps a short title whole", () => {
    expect(epicTagName("Queue alerts")).toBe("queue-alerts");
    expect(epicTagName("Expiration monitoring")).toBe("expiration-monitoring");
  });

  it("cuts a long title at a word, a little longer than a usual tag", () => {
    const name = epicTagName("Queue alerts for the ingest pipeline");
    expect(name).toBe("queue-alerts-for-the-ingest");
    expect(name.length).toBeLessThanOrEqual(EPIC_TAG_MAX);
  });

  it("never ends on a dash or mid-word when a word boundary is in reach", () => {
    for (const title of [
      "Engine preparation and rollout plan",
      "Migrate the shop to the new cluster in Frankfurt",
      "ASR: expiration monitoring, phase two",
    ]) {
      const name = epicTagName(title);
      expect(name.length).toBeLessThanOrEqual(EPIC_TAG_MAX);
      expect(name.endsWith("-")).toBe(false);
      // Every piece of the tag is a whole word of the title.
      const words = title.toLowerCase().replace(/[^a-z0-9\s-]/g, "").split(/[\s-]+/);
      for (const piece of name.split("-")) expect(words).toContain(piece);
    }
  });

  it("cuts one endless word where the limit falls", () => {
    expect(epicTagName("supercalifragilisticexpialidocious-ness")).toHaveLength(EPIC_TAG_MAX);
  });

  it("steps aside from words the capture bar would eat", () => {
    expect(epicTagName("Today")).toBe("today-epic");
    expect(epicTagName("High")).toBe("high-epic");
  });

  it("still names an epic whose title is all punctuation", () => {
    expect(epicTagName("!!!")).toBe("project");
  });

  it("uses the epic's number when its title has no letter the tag alphabet keeps", () => {
    expect(epicTagName("Мониторинг очередей", "VST-210")).toBe("vst-210");
    expect(epicTagName("🚀🚀", "VST-214")).toBe("vst-214");
    // An accent is not a reason: the letter under it is kept.
    expect(epicTagName("Épica de métricas", "VST-9")).toBe("epica-de-metricas");
  });
});

describe("doneByDefault", () => {
  it("names the finished tickets, wherever they hang, so a pull starts without its history", () => {
    const mixed: PullForest = {
      coords: [{ ticket: COORD, epics: [{ ticket: QUEUE, stories: [RULES, LATENCY] }] }],
      epics: [{ ticket: BOARDS, stories: [ticket("VST-300", "Old board", "done")] }],
      loose: [ticket("VST-301", "Old chore", "done"), RUNBOOK],
    };
    expect(doneByDefault(mixed).sort()).toEqual(["VST-230", "VST-300", "VST-301"]);
  });

  it("never unticks a COORD or an epic for being done: what is under them may not be", () => {
    const closed: PullForest = {
      coords: [{ ticket: ticket("COOR-9", "Closed", "done"), epics: [{ ticket: ticket("VST-9", "Closed epic", "done"), stories: [RUNBOOK] }] }],
      epics: [],
      loose: [],
    };
    expect(doneByDefault(closed)).toEqual([]);
  });
});
