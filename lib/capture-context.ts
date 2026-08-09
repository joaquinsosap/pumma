import type { GoalCategory, OmniType } from "@/lib/types";
import { formatDay } from "@/lib/date";

export type CaptureContext = {
  type: OmniType;
  projectId?: string | null;
  due?: string | null;
  goalCategory?: GoalCategory;
  hint?: string;
  placeholder: string;
};

type ProjectRef = { id: string; title: string };

function projectFromParams(
  searchParams: URLSearchParams,
  projects: ProjectRef[]
): ProjectRef | null {
  const projectId = searchParams.get("project");
  if (!projectId) return null;
  return projects.find((p) => p.id === projectId) ?? null;
}

function withActiveProject(
  base: CaptureContext,
  project: ProjectRef | null
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
  projects: ProjectRef[] = []
): CaptureContext {
  if (pathname === "/habits") {
    return {
      type: "habit",
      placeholder: 'New habit… try "read 20 min" or "stretch #health"',
    };
  }

  if (pathname === "/goals") {
    const category =
      searchParams.get("category") === "work"
        ? "work"
        : "personal";
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
      placeholder:
        'New note… try "Meeting ideas: discuss roadmap #work" or just jot thoughts',
    };
  }

  if (pathname === "/projects") {
    const projectId =
      searchParams.get("project") ?? projects[0]?.id ?? null;
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
        : 'Capture a task… try "pay rent friday #finance !high: transfer to the landlord"',
    };
    return withActiveProject(base, projectFromParams(searchParams, projects));
  }

  return {
    type: defaultType,
    placeholder: 'Capture a thought… try "pay rent friday #finance"',
  };
}
