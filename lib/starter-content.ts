import "server-only";
import { addDays, iso, oid } from "@/lib/date";
import { starterHash, type StarterEntry } from "@/lib/starter";
import type {
  GoalDoc,
  HabitDoc,
  NoteDoc,
  ProjectDoc,
  TaskDoc,
} from "@/lib/schemas";

/**
 * What a new account opens on.
 *
 * The brief was "the least that still explains the place". Every space gets
 * exactly one example of the thing that space is for, and each example is
 * chosen to demonstrate a feature that is invisible when the space is empty:
 * the task carries a due date, a priority and subtasks; the habit has a
 * schedule; the goal has something underneath it to roll up from; the project
 * has cards on both sides of the board.
 *
 * They are written as instructions rather than as somebody else's life. A
 * sample task called "Buy oat milk" is clutter in your list. "Tick me off" is
 * a button that happens to be a task, and it earns its place until it is used
 * once.
 */
export type StarterBundle = {
  tasks: TaskDoc[];
  notes: NoteDoc[];
  habits: HabitDoc[];
  goals: GoalDoc[];
  projects: ProjectDoc[];
  manifest: StarterEntry[];
};

export function buildStarterContent(
  userId: string,
  lifeTagIds: string[] = [],
): StarterBundle {
  const today = iso();
  const tomorrow = iso(addDays(1));
  const personal = lifeTagIds.slice(0, 1);

  const projectId = oid();
  const habitId = oid();
  const goalId = oid();

  const projects: ProjectDoc[] = [
    {
      _id: projectId,
      userId,
      title: "My first project",
      description:
        "Projects group tasks and roll their progress into a goal. Rename this one, or delete it once you have your own.",
      color: "oklch(0.58 0.14 245)",
      progress: 0,
      label: "",
      goalId: null,
      tagIds: [...personal],
      lifeArea: "personal",
      createdAt: today,
    },
  ];

  const tasks: TaskDoc[] = [
    {
      _id: oid(),
      userId,
      title: "Tick me off to see the day fill up",
      description:
        "The ring at the top of Home is today's tasks. Completing this moves it.",
      subtasks: [
        { id: oid(), title: "Steps live in here", done: false },
        { id: oid(), title: "Add your own with +", done: false },
      ],
      tagIds: [...personal],
      priority: "high",
      status: "todo",
      due: today,
      projectId: null,
      goalId: null,
      lifeArea: "personal",
      order: -1,
      createdAt: today,
      completedAt: null,
      timeSpentSec: 0,
      timerStartedAt: null,
    },
    {
      _id: oid(),
      userId,
      title: "Drag me across the board",
      description: "",
      subtasks: [],
      tagIds: [...personal],
      priority: "med",
      status: "todo",
      due: tomorrow,
      projectId,
      goalId: null,
      lifeArea: "personal",
      order: 0,
      createdAt: today,
      completedAt: null,
      timeSpentSec: 0,
      timerStartedAt: null,
    },
    {
      _id: oid(),
      userId,
      title: "Something already finished, for contrast",
      description: "",
      subtasks: [],
      tagIds: [...personal],
      priority: "low",
      status: "done",
      due: today,
      projectId,
      goalId: null,
      lifeArea: "personal",
      order: 1,
      createdAt: today,
      completedAt: today,
      timeSpentSec: 0,
      timerStartedAt: null,
    },
  ];

  const habits: HabitDoc[] = [
    {
      _id: habitId,
      userId,
      name: "Show up every day",
      color: "oklch(0.6 0.13 155)",
      frequency: { type: "daily", target: 1 },
      order: 0,
      archived: false,
      goalIds: [goalId],
      goalTargetStreak: 7,
      tagIds: [...personal],
      lifeArea: "personal",
      createdAt: today,
    },
    {
      _id: oid(),
      userId,
      name: "Weekdays only",
      color: "oklch(0.58 0.14 245)",
      frequency: { type: "weekly", target: 1, days: [1, 2, 3, 4, 5] },
      order: 1,
      archived: false,
      goalIds: [],
      goalTargetStreak: null,
      tagIds: [...personal],
      lifeArea: "personal",
      createdAt: today,
    },
  ];

  const goals: GoalDoc[] = [
    {
      _id: goalId,
      userId,
      title: "Keep a streak for a week",
      category: "personal",
      metricLabel: "",
      progress: 0,
      targetDate: null,
      tagIds: [...personal],
      lifeArea: "personal",
      order: 0,
      createdAt: today,
    },
  ];

  const notes: NoteDoc[] = [
    {
      _id: oid(),
      userId,
      title: "How capture works",
      body: [
        "Start typing anywhere and the bar at the top catches it.",
        "",
        "#tag files it. !high sets priority. A date word like tomorrow sets the due date. Tab cycles between task, habit, goal and note.",
        "",
        "Everything here is an example. Settings has a button that removes the ones you have not made your own.",
      ].join("\n"),
      tagIds: [...personal],
      pinned: false,
      lifeArea: "personal",
      createdAt: today,
      updatedAt: today,
    },
  ];

  const manifest: StarterEntry[] = [
    ...tasks.map((d) => entry("task", d)),
    ...notes.map((d) => entry("note", d)),
    ...habits.map((d) => entry("habit", d)),
    ...goals.map((d) => entry("goal", d)),
    ...projects.map((d) => entry("project", d)),
  ];

  return { tasks, notes, habits, goals, projects, manifest };
}

function entry(
  kind: StarterEntry["kind"],
  doc: { _id: string } & Record<string, unknown>,
): StarterEntry {
  return { kind, id: doc._id, hash: starterHash(kind, doc) };
}
