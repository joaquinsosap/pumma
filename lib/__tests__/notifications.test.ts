import { describe, it, expect } from "vitest";
import {
  DEFAULT_NOTIFICATION_SETTINGS,
  eventStartFrom,
  relativeToNow,
  worthSending,
  REPLAN_SAFE_MS,
  LATE_TOLERANCE_MS,
  LEAD_CHOICES,
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

describe("live relative time", () => {
  const now = new Date("2026-08-25T12:00:00Z");

  it("works the event's own moment back from the fire time", () => {
    // The row stores when we SPEAK, not when the thing happens.
    expect(eventStartFrom("2026-08-25T17:50:00.000Z", 10)).toBe(
      "2026-08-25T18:00:00.000Z",
    );
    expect(eventStartFrom("2026-08-25T18:00:00.000Z", 0)).toBe(
      "2026-08-25T18:00:00.000Z",
    );
  });

  it("counts forwards and backwards, so a passed reminder stops lying", () => {
    expect(relativeToNow("2026-08-25T12:10:00Z", now)).toBe("in 10 min");
    expect(relativeToNow("2026-08-25T11:50:00Z", now)).toBe("10 min ago");
    expect(relativeToNow("2026-08-25T12:00:20Z", now)).toBe("now");
    expect(relativeToNow("2026-08-25T13:30:00Z", now)).toBe("in 1h 30m");
    expect(relativeToNow("2026-08-25T10:00:00Z", now)).toBe("2h ago");
  });

  it("keeps the stored body free of anything that goes stale", () => {
    const got = planNotifications(
      base({ agenda: [meeting({ id: "m1", time: "15:00" })] }),
    );
    // Absolute, and the whole slot. Anything relative is computed on read.
    expect(got[0].body).toBe("15:00 to 15:30");
  });
});

describe("worth sending", () => {
  // A 09:00 meeting with a ten minute lead: we mean to speak at 08:50.
  const fireAt = "2026-08-26T11:50:00.000Z"; // 08:50 in UTC-3
  const lead = 10;
  const at = (hhmm: string) => new Date(`2026-08-26T${hhmm}:00.000Z`);

  it("sends when it is on time", () => {
    expect(worthSending(fireAt, lead, at("11:50"))).toBe(true);
    expect(worthSending(fireAt, lead, at("11:51"))).toBe(true);
  });

  it("still sends a late warning while the thing has not started", () => {
    // Five minutes late is late, but there are five minutes left, so the
    // reminder can still do its job.
    expect(worthSending(fireAt, lead, at("11:55"))).toBe(true);
  });

  it("goes quiet once the meeting has begun", () => {
    // The bug: this used to keep sending until 20 minutes past the hour, and
    // a reminder arriving after the meeting started is worse than silence,
    // because you reach for your phone thinking you still have time.
    expect(worthSending(fireAt, lead, at("12:01"))).toBe(false);
    expect(worthSending(fireAt, lead, at("12:16"))).toBe(false);
  });

  it("gives an on-time reminder its moment", () => {
    // lead 0 means fireAt IS the event, so "already started" would reject it
    // instantly without the tolerance.
    const now = "2026-08-26T12:00:00.000Z";
    expect(worthSending(now, 0, at("12:00"))).toBe(true);
    expect(worthSending(now, 0, at("12:01"))).toBe(true);
    expect(worthSending(now, 0, at("12:20"))).toBe(false);
  });
});

describe("planning stops at the event, not at the reminder", () => {
  it("does not plan a reminder for a meeting already under way", () => {
    const got = planNotifications(
      base({
        // 09:00 local, and it is already 09:05.
        now: new Date("2026-08-25T12:05:00Z"),
        agenda: [meeting({ id: "m1", time: "09:00" })],
      }),
    );
    expect(got).toHaveLength(0);
  });

  it("still plans one that has not started, even if we are late saying so", () => {
    const got = planNotifications(
      base({
        // 08:55: past the 08:50 fire time, but the meeting is still ahead.
        now: new Date("2026-08-25T11:55:00Z"),
        agenda: [meeting({ id: "m1", time: "09:00" })],
      }),
    );
    expect(got).toHaveLength(1);
  });
});

describe("the body carries the whole slot", () => {
  it("stores a range rather than a start time", () => {
    const got = planNotifications(
      base({ agenda: [meeting({ id: "m1", time: "15:00", durationMins: 30 })] }),
    );
    expect(got[0].body).toBe("15:00 to 15:30");
  });
});

describe("the prune must not re-arm what it deletes", () => {
  it("protects anything the planner could still rebuild", () => {
    // The loop this guards against: the prune drops a delivered row to hold
    // the tray at its limit, the next planning pass sees that meeting still
    // ahead inside the horizon and no row for it, and creates a fresh one
    // marked scheduled. It fires again. From outside, that is a reminder
    // going off at random.
    //
    // A day is past every lead time on offer, so a row older than this can
    // never be justified by the planner again.
    expect(REPLAN_SAFE_MS).toBeGreaterThan(
      Math.max(...LEAD_CHOICES) * 60 * 1000,
    );
    // And past the point where worthSending would still deliver it.
    expect(REPLAN_SAFE_MS).toBeGreaterThan(LATE_TOLERANCE_MS);
  });

  it("keeps a delivered row alive while its meeting is still ahead", () => {
    // Same meeting, planned twice. The second pass must not produce a row
    // the first pass already delivered, which is only true while that row
    // still exists to be upserted over.
    const agenda = [meeting({ id: "m1", time: "15:00" })];
    const first = planNotifications(base({ agenda }));
    const second = planNotifications(base({ agenda }));
    expect(second.map((n) => n.id)).toEqual(first.map((n) => n.id));
  });
});
