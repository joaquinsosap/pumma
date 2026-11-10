import type { GoalCategory, OmniType } from "@/lib/types";
import { formatDay } from "@/lib/date";
import { parseLifeView } from "@/lib/life-area";
import { goalCategoryForLifeArea } from "@/lib/life-area-sync";

export type CaptureContext = {
  type: OmniType;
  projectId?: string | null;
  due?: string | null;
  goalCategory?: GoalCategory;
  hint?: string;
  placeholder: string;
};

type ProjectRef = { id: string; title: string };

/** What each kind of capture is called on a button. */
export const CAPTURE_NAMES: Record<OmniType, string> = {
  task: "task",
  habit: "habit",
  goal: "goal",
  note: "note",
};

/** What the bar suggests typing for each kind, on a page with nothing more specific to say. */
const KIND_PLACEHOLDER: Record<OmniType, string> = {
  task: 'Capture a task… try "pay rent friday #finance !high: transfer to the landlord"',
  habit: 'New habit… try "read 20 min" or "stretch #health"',
  goal: 'New goal… try "run a half marathon"',
  note: 'New note… try "Meeting ideas: discuss roadmap #work" or just jot thoughts',
};

/** The words in the empty bar while it is set to make a project. */
export const PROJECT_PLACEHOLDER = 'New project… name it, like "Website redesign"';

/**
 * The words in the empty bar. The page's own while the bar makes what the page
 * makes ("Add to Website redesign…"); the kind's own once it has been switched
 * to something else, so a bar set to habits on Home does not go on asking for
 * a task.
 */
export function capturePlaceholder(
  capture: CaptureContext,
  type: OmniType,
): string {
  return type === capture.type ? capture.placeholder : KIND_PLACEHOLDER[type];
}

/** The pages whose title carries a "New ..." button, and what it makes there. */
const BUTTON_PAGES: { path: string; type: OmniType }[] = [
  { path: "/tasks", type: "task" },
  { path: "/projects", type: "task" },
  { path: "/calendar", type: "task" },
  { path: "/notes", type: "note" },
  { path: "/habits", type: "habit" },
  { path: "/goals", type: "goal" },
];

/**
 * The kind of thing a page's "New ..." button makes, or null where a page has
 * none: Settings, the assistant and the life calendar are not places you add
 * a task from. Home makes a task, whatever the default capture is set to: the
 * button says what it does, and its widgets carry the other kinds.
 */
export function captureButtonFor(pathname: string): OmniType | null {
  if (pathname === "/") return "task";
  const page = BUTTON_PAGES.find(
    (p) => pathname === p.path || pathname.startsWith(`${p.path}/`),
  );
  return page?.type ?? null;
}

function projectFromParams(
  searchParams: URLSearchParams,
  projects: ProjectRef[],
): ProjectRef | null {
  const projectId = searchParams.get("project");
  if (!projectId) return null;
  return projects.find((p) => p.id === projectId) ?? null;
}

function withActiveProject(
  base: CaptureContext,
  project: ProjectRef | null,
): CaptureContext {
  if (!project) return base;
  const hintParts = [project.title, base.hint].filter(Boolean);
  return {
    ...base,
    projectId: project.id,
    hint: hintParts.join(" · "),
    placeholder: `Add to ${project.title}… try "review specs #work !high"`,
  };
}

export function getCaptureContext(
  pathname: string,
  searchParams: URLSearchParams,
  defaultType: OmniType = "task",
  projects: ProjectRef[] = [],
): CaptureContext {
  if (pathname === "/habits") {
    return {
      type: "habit",
      placeholder: KIND_PLACEHOLDER.habit,
    };
  }

  if (pathname === "/goals") {
    // Which column a new goal lands in follows the life area you are already
    // in, not a column you clicked.
    //
    // Goals is the one page that shows Personal and Work side by side, so
    // "select a column" was invisible state on a page whose whole point is
    // that you can see both at once: clicking tinted a column and changed
    // nothing you could name. The side of life is already decided by where
    // you are, and a #tag in the captured line still overrides it (see the
    // askedForLife check in lib/actions/tasks).
    const category = goalCategoryForLifeArea(
      parseLifeView(searchParams.get("life")),
    );
    const label = category === "work" ? "Work" : "Personal";
    return {
      type: "goal",
      goalCategory: category,
      hint: label,
      placeholder: `New ${category} goal… try "run a half marathon"`,
    };
  }

  if (pathname === "/notes" || pathname.startsWith("/notes/")) {
    return {
      type: "note",
      placeholder: KIND_PLACEHOLDER.note,
    };
  }

  if (pathname === "/projects") {
    const projectId = searchParams.get("project") ?? projects[0]?.id ?? null;
    const project = projects.find((p) => p.id === projectId);
    return {
      type: "task",
      projectId,
      hint: project?.title,
      placeholder: project
        ? `Add to ${project.title}… try "review specs #work !high"`
        : 'Add to project… try "review specs #work !high"',
    };
  }

  if (pathname === "/calendar") {
    const day = searchParams.get("day");
    const base: CaptureContext = {
      type: "task",
      due: day,
      hint: day ? formatDay(day) : undefined,
      placeholder: day
        ? `Schedule for ${formatDay(day)}… try "dentist 2pm #health"`
        : 'Schedule a task… try "dentist friday #health"',
    };
    return withActiveProject(base, projectFromParams(searchParams, projects));
  }

  if (pathname === "/tasks" || pathname === "/") {
    const day = searchParams.get("day");
    const base: CaptureContext = {
      type: "task",
      due: day,
      hint: day ? formatDay(day) : undefined,
      placeholder: day
        ? `Add for ${formatDay(day)}… try "call dentist #health"`
        : KIND_PLACEHOLDER.task,
    };
    return withActiveProject(base, projectFromParams(searchParams, projects));
  }

  return {
    type: defaultType,
    placeholder: 'Capture a thought… try "pay rent friday #finance"',
  };
}
