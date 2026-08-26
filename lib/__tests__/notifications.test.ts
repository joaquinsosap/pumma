import { describe, it, expect } from "vitest";
import {
  DEFAULT_NOTIFICATION_SETTINGS,
  HISTORY_KEEP,
  HISTORY_MAX_AGE_DAYS,
  leadPhrase,
  notificationId,
  planNotifications,
  type NotificationSettings,
} from "@/lib/notifications";
import type { AgendaItem, Task } from "@/lib/schemas";

const TZ = "America/Montevideo"; // UTC-3, no DST — arithmetic stays checkable

const meeting = (over: Partial<AgendaItem> & { id: string }): AgendaItem =>
  ({
    userId: "u",
    kind: "meeting",
    title: "Standup",
    date: "2026-08-25",
    time: "10:00",
    durationMins: 30,
    notes: "",
    recurrence: null,
    lifeArea: "work",
    color: "var(--calendar)",
    createdAt: "2026-08-01",
    ...over,
  }) as AgendaItem;

const task = (over: Partial<Task> & { id: string }): Task =>
  ({
    userId: "u",
    title: "Ship it",
    description: "",
    subtasks: [],
    tagIds: [],
    priority: "med",
    status: "todo",
    due: null,
    projectId: null,
    goalId: null,
    lifeArea: "work",
    order: 0,
    createdAt: "2026-08-01",
    completedAt: null,
    ...over,
  }) as Task;

const base = (over: Partial<Parameters<typeof planNotifications>[0]> = {}) => ({
  userId: "u1",
  timeZone: TZ,
  now: new Date("2026-08-25T12:00:00Z"), // 09:00 local
  today: "2026-08-25",
  horizonEnd: "2026-08-27",
  settings: DEFAULT_NOTIFICATION_SETTINGS,
  agenda: [] as AgendaItem[],
  tasks: [] as Task[],
  ...over,
});

describe("notificationId", () => {
  it("is the same for the same thing, so re-planning upserts", () => {
    const a = notificationId("u", "meeting", "m1", "2026-08-25", 10);
    const b = notificationId("u", "meeting", "m1", "2026-08-25", 10);
    expect(a).toBe(b);
  });

  it("separates users, occurrences and lead times", () => {
    const id = (u: string, d: string, lead: number) =>
      notificationId(u, "meeting", "m1", d, lead);
    const all = new Set([
      id("u1", "2026-08-25", 10),
      id("u2", "2026-08-25", 10),
      id("u1", "2026-08-26", 10),
      id("u1", "2026-08-25", 30),
    ]);
    expect(all.size).toBe(4);
  });
});

describe("planNotifications — meetings", () => {
  it("fires the configured minutes before, in the user's timezone", () => {
    const got = planNotifications(
      base({ agenda: [meeting({ id: "m1", time: "15:00" })] }),
    );
    expect(got).toHaveLength(1);
    // 15:00 local in UTC-3 is 18:00Z; ten minutes before is 17:50Z.
    expect(got[0].fireAt).toBe("2026-08-25T17:50:00.000Z");
    expect(got[0].title).toBe("Standup");
  });

  it("makes one notification per lead time", () => {
    const settings: NotificationSettings = {
      ...DEFAULT_NOTIFICATION_SETTINGS,
      meetingLeadMins: [60, 5],
    };
    const got = planNotifications(
      base({ settings, agenda: [meeting({ id: "m1", time: "15:00" })] }),
    );
    expect(got.map((n) => n.leadMins)).toEqual([60, 5]);
    // Sorted by when they fire, so the hour-ahead one comes first.
    expect(got[0].fireAt < got[1].fireAt).toBe(true);
  });

  it("ignores a duplicate lead time", () => {
    const settings: NotificationSettings = {
      ...DEFAULT_NOTIFICATION_SETTINGS,
      meetingLeadMins: [10, 10, 10],
    };
    const got = planNotifications(
      base({ settings, agenda: [meeting({ id: "m1", time: "15:00" })] }),
    );
    expect(got).toHaveLength(1);
  });

  it("skips all-day events, which have no moment to be early for", () => {
    const got = planNotifications(
      base({ agenda: [meeting({ id: "m1", time: "all day" })] }),
    );
    expect(got).toHaveLength(0);
  });

  it("carries the join link out of the invite", () => {
    const got = planNotifications(
      base({
        agenda: [
          meeting({
            id: "m1",
            time: "15:00",
            notes:
              "Join the meeting now https://teams.microsoft.com/l/meetup-join/x",
          }),
        ],
      }),
    );
    expect(got[0].joinUrl).toContain("teams.microsoft.com");
  });

  it("expands a repeat into one notification per occurrence", () => {
    const got = planNotifications(
      base({
        agenda: [
          meeting({
            id: "m1",
            time: "15:00",
            recurrence: {
              freq: "daily",
              interval: 1,
              byWeekday: [],
              until: null,
              count: null,
            },
          }),
        ],
      }),
    );
    expect(got.length).toBeGreaterThan(1);
    // Each occurrence gets its own id, or they would overwrite each other.
    expect(new Set(got.map((n) => n.id)).size).toBe(got.length);
  });

  it("does not fire for a meeting that already happened", () => {
    const got = planNotifications(
      base({ agenda: [meeting({ id: "m1", time: "06:00" })] }),
    );
    expect(got).toHaveLength(0);
  });

  it("says nothing when meetings are switched off", () => {
    const got = planNotifications(
      base({
        settings: { ...DEFAULT_NOTIFICATION_SETTINGS, meetingsEnabled: false },
        agenda: [meeting({ id: "m1", time: "15:00" })],
      }),
    );
    expect(got).toHaveLength(0);
  });
});

describe("planNotifications — tasks", () => {
  it("fires for a task due at a time", () => {
    const got = planNotifications(
      base({ tasks: [task({ id: "t1", due: "2026-08-25T16:00" })] }),
    );
    expect(got).toHaveLength(1);
    expect(got[0].fireAt).toBe("2026-08-25T19:00:00.000Z");
    expect(got[0].url).toBe("/tasks?task=t1");
  });

  it("ignores a task with only a date — midnight is not a reminder", () => {
    const got = planNotifications(
      base({ tasks: [task({ id: "t1", due: "2026-08-26" })] }),
    );
    expect(got).toHaveLength(0);
  });

  it("ignores a task already done", () => {
    const got = planNotifications(
      base({
        tasks: [task({ id: "t1", due: "2026-08-25T16:00", status: "done" })],
      }),
    );
    expect(got).toHaveLength(0);
  });

  it("respects the task lead time", () => {
    const got = planNotifications(
      base({
        settings: { ...DEFAULT_NOTIFICATION_SETTINGS, taskLeadMins: 30 },
        tasks: [task({ id: "t1", due: "2026-08-25T16:00" })],
      }),
    );
    expect(got[0].fireAt).toBe("2026-08-25T18:30:00.000Z");
  });
});

describe("planNotifications — digest", () => {
  const settings: NotificationSettings = {
    ...DEFAULT_NOTIFICATION_SETTINGS,
    meetingsEnabled: false,
    tasksEnabled: false,
    digestEnabled: true,
    digestTime: "09:00",
  };

  it("counts the day's tasks and fires at the chosen local time", () => {
    const got = planNotifications(
      base({
        settings,
        tasks: [
          task({ id: "t1", due: "2026-08-26" }),
          task({ id: "t2", due: "2026-08-26T10:00" }),
        ],
      }),
    );
    const tomorrow = got.find((n) => n.entityDate === "2026-08-26");
    expect(tomorrow?.title).toBe("2 tasks today");
    expect(tomorrow?.fireAt).toBe("2026-08-26T12:00:00.000Z");
  });

  it("stays quiet on a day with nothing due", () => {
    const got = planNotifications(base({ settings, tasks: [] }));
    expect(got).toHaveLength(0);
  });
});

describe("leadPhrase", () => {
  it("reads like a person wrote it", () => {
    expect(leadPhrase(0)).toBe("now");
    expect(leadPhrase(10)).toBe("in 10 min");
    expect(leadPhrase(60)).toBe("in 1h");
    expect(leadPhrase(90)).toBe("in 1h 30m");
  });
});

describe("history retention", () => {
  it("keeps a handful, not an archive", () => {
    // The tray answers "what did I miss", which is about the last few things.
    // If this number ever grows a lot, the divider and the delete button stop
    // being enough to keep the list readable.
    expect(HISTORY_KEEP).toBeLessThanOrEqual(10);
    expect(HISTORY_KEEP).toBeGreaterThan(0);
  });

  it("also bounds by age, for the account with one reminder a week", () => {
    expect(HISTORY_MAX_AGE_DAYS).toBeGreaterThan(0);
    expect(HISTORY_MAX_AGE_DAYS).toBeLessThanOrEqual(30);
  });
});
