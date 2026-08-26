import type {
  AgendaItemDoc,
  GoalDoc,
  HabitDoc,
  HabitEntryDoc,
  LifeDayDoc,
  LifeWeekDoc,
  NoteDoc,
  ProjectDoc,
  SettingsDoc,
  TagDoc,
  TaskDoc,
  UserDoc,
  CalendarFeedDoc,
  ExternalEventDoc,
  NotificationDoc,
  PushSubscriptionDoc,
} from "@/lib/schemas";
import { taskSchema } from "@/lib/schemas";
import { LIFE_SPAN_DEFAULT } from "@/lib/life-constants";
import { addDays, iso, oid } from "@/lib/date";
import { projectTagSlug } from "@/lib/project-tags";

export type SeedData = {
  users: UserDoc[];
  settings: SettingsDoc[];
  tags: TagDoc[];
  tasks: TaskDoc[];
  habits: HabitDoc[];
  habitEntries: HabitEntryDoc[];
  notes: NoteDoc[];
  goals: GoalDoc[];
  projects: ProjectDoc[];
  agenda: AgendaItemDoc[];
  lifeDays: LifeDayDoc[];
  lifeWeeks: LifeWeekDoc[];
  /** Subscribed calendars, and the events read out of them. Seeded empty:
   *  a demo account has nobody else's calendar to read. */
  calendarFeeds: CalendarFeedDoc[];
  externalEvents: ExternalEventDoc[];
  notifications: NotificationDoc[];
  pushSubscriptions: PushSubscriptionDoc[];
};

export function createSeedData(userId: string): SeedData {
  const td = iso();
  const yd = iso(addDays(-1));

  const tagDefs: [string, string, boolean][] = [
    ["idea", "oklch(0.58 0.17 300)", false],
    ["work", "oklch(0.58 0.14 245)", false],
    ["health", "oklch(0.6 0.13 155)", false],
    ["finance", "oklch(0.7 0.12 70)", false],
    ["personal", "oklch(0.55 0.16 274)", false],
  ];

  const tags: TagDoc[] = tagDefs.map((t, i) => ({
    _id: oid(),
    userId,
    name: t[0],
    color: t[1],
    isDefault: t[2],
    projectId: null,
    isProjectPrimary: false,
    order: i,
    createdAt: td,
  }));

  const T = (n: string) => tags.find((x) => x.name === n)!._id;

  const projects: ProjectDoc[] = [
    {
      _id: oid(),
      userId,
      title: "Website redesign",
      description:
        "Refresh marketing site: new typography, case studies, and a faster contact flow.",
      color: "oklch(0.58 0.14 245)",
      progress: 80,
      label: "16/20",
      goalId: null,
      tagIds: [],
      lifeArea: "personal",
      createdAt: td,
    },
    {
      _id: oid(),
      userId,
      title: "Learn Spanish",
      description:
        "Reach B1 by end of year. Focus on conversation + Anki daily.",
      color: "oklch(0.58 0.17 300)",
      progress: 45,
      label: "B1 · u9",
      goalId: null,
      tagIds: [],
      lifeArea: "personal",
      createdAt: td,
    },
    {
      _id: oid(),
      userId,
      title: "Home office setup",
      description: "Standing desk, lighting, and cable management.",
      color: "oklch(0.6 0.13 155)",
      progress: 60,
      label: "6/10",
      goalId: null,
      tagIds: [],
      lifeArea: "personal",
      createdAt: td,
    },
    {
      _id: oid(),
      userId,
      title: "Side app MVP",
      description: "Ship a minimal life-OS prototype for friends to try.",
      color: "oklch(0.64 0.18 25)",
      progress: 28,
      label: "7/25",
      goalId: null,
      tagIds: [],
      lifeArea: "personal",
      createdAt: td,
    },
  ];

  // Every project owns a flagship tag named after it — same rule the app
  // applies on create, so the fixture matches a real account.
  for (const [i, project] of projects.entries()) {
    tags.push({
      _id: oid(),
      userId,
      name: projectTagSlug(project.title),
      color: project.color,
      isDefault: false,
      projectId: project._id,
      isProjectPrimary: true,
      order: tags.length + i,
      createdAt: td,
    });
  }

  /** Everything carries the life tag its area implies — same rule as the app. */
  const withLife = <T extends { lifeArea: string; tagIds: string[] }>(
    rows: T[],
  ): T[] =>
    rows.map((row) => {
      const wanted =
        row.lifeArea === "both"
          ? ["personal", "work"]
          : row.lifeArea === "work"
            ? ["work"]
            : ["personal"];
      const add = wanted.map(T).filter((id) => !row.tagIds.includes(id));
      return add.length ? { ...row, tagIds: [...row.tagIds, ...add] } : row;
    });

  const tasks = [
    {
      _id: oid(),
      userId,
      title: "Review Q3 OKRs draft",
      tagIds: [T("work")],
      priority: "med",
      status: "done",
      due: td,
      projectId: null,
      goalId: null,
      lifeArea: "personal",
      order: 0,
      createdAt: td,
      completedAt: td,
    },
    {
      _id: oid(),
      userId,
      title: "Morning run · 5k",
      tagIds: [T("health")],
      priority: "low",
      status: "done",
      due: td,
      projectId: null,
      goalId: null,
      lifeArea: "personal",
      order: 1,
      createdAt: td,
      completedAt: td,
    },
    {
      _id: oid(),
      userId,
      title: "Draft launch email to beta list",
      description:
        "Highlight the new capture flow and life calendar. Keep it under 200 words.",
      subtasks: [
        { id: oid(), title: "Write subject line options", done: true },
        { id: oid(), title: "Pull beta metrics snippet", done: false },
        { id: oid(), title: "Proofread and schedule", done: false },
      ],
      tagIds: [T("work")],
      priority: "high",
      status: "todo",
      due: td,
      projectId: projects[0]._id,
      goalId: null,
      lifeArea: "personal",
      order: 2,
      createdAt: td,
      completedAt: null,
    },
    {
      _id: oid(),
      userId,
      title: "Call Mom",
      tagIds: [T("personal")],
      priority: "med",
      status: "todo",
      due: td + "T14:00",
      projectId: null,
      goalId: null,
      lifeArea: "personal",
      order: 3,
      createdAt: td,
      completedAt: null,
    },
    {
      _id: oid(),
      userId,
      title: "Finish ch. 4 of Atomic Habits",
      tagIds: [T("idea")],
      priority: "low",
      status: "todo",
      due: td,
      projectId: null,
      goalId: null,
      lifeArea: "personal",
      order: 4,
      createdAt: td,
      completedAt: null,
    },
    {
      _id: oid(),
      userId,
      title: "Send invoice to client",
      tagIds: [T("work"), T("finance")],
      priority: "high",
      status: "todo",
      due: yd,
      projectId: null,
      goalId: null,
      lifeArea: "personal",
      order: 5,
      createdAt: yd,
      completedAt: null,
    },
    {
      _id: oid(),
      userId,
      title: "Reply to Sam's email",
      tagIds: [],
      priority: "med",
      status: "todo",
      due: yd,
      projectId: null,
      goalId: null,
      lifeArea: "personal",
      order: 6,
      createdAt: yd,
      completedAt: null,
    },
    {
      _id: oid(),
      userId,
      title: "Pay rent",
      tagIds: [T("finance")],
      priority: "high",
      status: "todo",
      due: iso(addDays(1)),
      projectId: null,
      goalId: null,
      lifeArea: "personal",
      order: 7,
      createdAt: td,
      completedAt: null,
    },
    {
      _id: oid(),
      userId,
      title: "Review PR #214",
      tagIds: [T("work")],
      priority: "med",
      status: "todo",
      due: iso(addDays(1)),
      projectId: projects[3]._id,
      goalId: null,
      lifeArea: "personal",
      order: 8,
      createdAt: td,
      completedAt: null,
    },
    {
      _id: oid(),
      userId,
      title: "Book dentist",
      tagIds: [T("health")],
      priority: "low",
      status: "todo",
      due: iso(addDays(2)),
      projectId: null,
      goalId: null,
      lifeArea: "personal",
      order: 9,
      createdAt: td,
      completedAt: null,
    },
    {
      _id: oid(),
      userId,
      title: "Wireframe new homepage",
      tagIds: [T("work")],
      priority: "med",
      status: "done",
      due: iso(addDays(-3)),
      projectId: projects[0]._id,
      goalId: null,
      lifeArea: "personal",
      order: 10,
      createdAt: yd,
      completedAt: yd,
    },
    {
      _id: oid(),
      userId,
      title: "Design system audit",
      tagIds: [T("work")],
      priority: "med",
      status: "done",
      due: iso(addDays(-1)),
      projectId: projects[0]._id,
      goalId: null,
      lifeArea: "personal",
      order: 11,
      createdAt: yd,
      completedAt: yd,
    },
    {
      _id: oid(),
      userId,
      title: "Build hero section",
      tagIds: [T("work")],
      priority: "high",
      status: "doing",
      due: td,
      projectId: projects[0]._id,
      goalId: null,
      lifeArea: "personal",
      order: 12,
      createdAt: td,
      completedAt: null,
    },
    {
      _id: oid(),
      userId,
      title: "Migrate blog templates",
      tagIds: [T("work")],
      priority: "low",
      status: "todo",
      due: iso(addDays(3)),
      projectId: projects[0]._id,
      goalId: null,
      lifeArea: "personal",
      order: 13,
      createdAt: td,
      completedAt: null,
    },
    {
      _id: oid(),
      userId,
      title: "Set up CI pipeline",
      tagIds: [],
      priority: "med",
      status: "doing",
      due: iso(addDays(2)),
      projectId: projects[3]._id,
      goalId: null,
      lifeArea: "personal",
      order: 14,
      createdAt: td,
      completedAt: null,
    },
    {
      _id: oid(),
      userId,
      title: "Sketch onboarding flow",
      tagIds: [T("idea")],
      priority: "low",
      status: "todo",
      due: iso(addDays(4)),
      projectId: projects[3]._id,
      goalId: null,
      lifeArea: "personal",
      order: 15,
      createdAt: td,
      completedAt: null,
    },
  ];

  const habitDefs: [string, string, number, boolean][] = [
    ["Meditate", "daily", 12, true],
    ["Run / move", "daily", 5, true],
    ["Read 20 min", "daily", 3, true],
    ["Journal", "daily", 4, true],
    ["No phone post-10pm", "daily", 2, false],
    ["Drink 2L water", "daily", 4, false],
    ["Weekly review", "weekly", 8, true],
    ["Budget check", "monthly", 3, true],
  ];

  const habits: HabitDoc[] = [];
  const habitEntries: HabitEntryDoc[] = [];

  habitDefs.forEach((h, i) => {
    const id = oid();
    habits.push({
      _id: id,
      userId,
      name: h[0],
      color: "oklch(0.6 0.13 155)",
      frequency: { type: h[1], target: 1 },
      order: i,
      archived: false,
      goalIds: [],
      goalTargetStreak: null,
      tagIds: [],
      lifeArea: "personal",
      createdAt: td,
    });
    const start = h[3] ? 0 : 1;
    const len = h[2];
    for (let k = start; k < start + len; k++) {
      habitEntries.push({
        _id: oid(),
        userId,
        habitId: id,
        date: iso(addDays(-k)),
        done: true,
      });
    }
  });

  const goals: GoalDoc[] = [
    {
      _id: oid(),
      userId,
      title: "Run a half marathon",
      category: "personal",
      metricLabel: "",
      progress: 72,
      targetDate: null,
      tagIds: [],
      lifeArea: "personal",
      order: 0,
      createdAt: td,
    },
    {
      _id: oid(),
      userId,
      title: "Ship v2.0 release",
      category: "work",
      metricLabel: "",
      progress: 54,
      targetDate: null,
      tagIds: [],
      lifeArea: "work",
      order: 0,
      createdAt: td,
    },
    {
      _id: oid(),
      userId,
      title: "Save $10k buffer",
      category: "personal",
      metricLabel: "",
      progress: 40,
      targetDate: null,
      tagIds: [],
      lifeArea: "personal",
      order: 1,
      createdAt: td,
    },
  ];

  projects[0].goalId = goals[1]._id;
  projects[0].lifeArea = "work";
  projects[3].lifeArea = "work";
  goals[1].lifeArea = "work";

  const workTagId = T("work");
  for (const task of tasks) {
    if (
      task.tagIds.includes(workTagId) ||
      task.projectId === projects[0]._id ||
      task.projectId === projects[3]._id
    ) {
      task.lifeArea = "work";
    }
  }

  const runHabit = habits.find((h) => h.name === "Run / move");
  if (runHabit) {
    runHabit.goalIds = [goals[0]._id];
    runHabit.goalTargetStreak = 30;
  }

  const notes: NoteDoc[] = [
    {
      _id: oid(),
      userId,
      title: "Podcast idea: interview solo founders",
      body: "30-min audio format. Pull guests from DMs.",
      tagIds: [T("idea")],
      pinned: false,
      lifeArea: "personal",
      createdAt: td,
      updatedAt: td,
    },
    {
      _id: oid(),
      userId,
      title: "Gift ideas for Sam's birthday",
      body: "Books, that lamp she liked, a weekend trip.",
      tagIds: [T("personal"), T("idea")],
      pinned: false,
      lifeArea: "personal",
      createdAt: yd,
      updatedAt: yd,
    },
    {
      _id: oid(),
      userId,
      title: "Pricing experiment results",
      body: "Annual plan converted 1.8x better at $9/mo.",
      tagIds: [T("work")],
      pinned: false,
      lifeArea: "work",
      createdAt: iso(addDays(-2)),
      updatedAt: iso(addDays(-2)),
    },
  ];

  // Real dated meetings — the same rows the Calendar renders, so Agenda and
  // Calendar always agree. (The old dateless "routine" rows were demo-only
  // fiction: they appeared every day in the Agenda but never on the Calendar.)
  const agendaBase = {
    kind: "meeting" as const,
    notes: "",
    exceptions: [] as string[],
  };
  const agenda: AgendaItemDoc[] = [
    {
      _id: oid(),
      userId,
      time: "09:30",
      title: "Standup + planning",
      sub: "meeting · 30 min",
      color: "oklch(0.58 0.14 245)",
      lifeArea: "work",
      date: td,
      durationMins: 30,
      // Weekdays — shows off the repeat rule the UI can now create.
      recurrence: {
        freq: "weekly" as const,
        interval: 1,
        byWeekday: [1, 2, 3, 4, 5],
        until: null,
        count: null,
      },
      ...agendaBase,
    },
    {
      _id: oid(),
      userId,
      time: "16:00",
      title: "1:1 with Sam",
      sub: "meeting · 45 min",
      color: "oklch(0.58 0.14 245)",
      lifeArea: "work",
      date: td,
      durationMins: 45,
      recurrence: null,
      ...agendaBase,
    },
  ];

  const user: UserDoc = {
    _id: userId,
    name: "Ignis",
    email: "alex@example.com",
    createdAt: td,
  };

  const settings: SettingsDoc = {
    _id: oid(),
    userId,
    theme: "light",
    defaultCaptureType: "task",
    defaultDueToday: true,
    defaultTasksTab: "all" as const,
    defaultTasksGroup: "none" as const,
    defaultTasksStatus: [],
    defaultTasksPriority: [],
    defaultHabitFrequency: "daily" as const,
    projectsRailSortVisible: false,
    nudgeHistory: {},
    nudgeAnswered: {},

    weekStart: "mon",
    birthDate: "1997-06-15",
    lifeSpanYears: LIFE_SPAN_DEFAULT,
    lifeCalendarFullView: false,
    showMeetingCodes: false,
    calendarLinkOffered: false,
    installOffered: false,
    sortReversed: [],
    notifications: {
      meetingsEnabled: true,
      meetingLeadMins: [10],
      tasksEnabled: true,
      taskLeadMins: 0,
      digestEnabled: false,
      digestTime: "09:00",
    },
    habitVisibleDays: 30,
    habitVisibleWeeks: 8,
    habitVisibleMonths: 3,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    aiApiKeyEnc: null,
    aiApiKeyLast4: null,
    aiProvider: "anthropic",
    aiModel: null,
    lifeAutoSwitch: false,
    workStart: "09:00",
    workEnd: "18:00",
    workDays: [1, 2, 3, 4, 5],
    lifeAutoOverrideMins: 60,
    spaceShortcuts: true,
    tagAutoClean: false,
    tagAutoCleanDays: 30,
    tagsCleanedAt: null,
    // The seeded demo has already 'seen' nothing — let the tour play.
    dateOrder: "dmy" as const,
    tutorialSeenAt: null,
    starterManifest: null,
    taskSort: "priority",
    projectTaskSort: "priority",
    projectSort: "created",
    noteSort: "edited",
    tagSort: "custom",
  };

  return {
    users: [user],
    settings: [settings],
    tags,
    tasks: withLife(tasks).map((t) => taskSchema.parse(t)),
    habits: withLife(habits),
    habitEntries,
    notes: withLife(notes),
    goals: withLife(goals),
    projects: withLife(projects),
    agenda,
    lifeDays: [],
    lifeWeeks: [],
    calendarFeeds: [],
    externalEvents: [],
    notifications: [],
    pushSubscriptions: [],
  };
}
