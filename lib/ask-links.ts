import { hrefWithLife, type LifeView } from "@/lib/life-area";
import { taskDetailHref } from "@/lib/task-links";
import type { EntityLifeArea } from "@/lib/types";

export type EntityKind = "task" | "project" | "goal" | "habit" | "note";

export type SnapshotTask = {
  id: string;
  title: string;
  due: string | null;
  lifeArea: EntityLifeArea;
};

export type SnapshotProject = {
  id: string;
  title: string;
  lifeArea: EntityLifeArea;
};

export type SnapshotGoal = {
  id: string;
  title: string;
  lifeArea: EntityLifeArea;
};

export type SnapshotHabit = {
  id: string;
  name: string;
  lifeArea: EntityLifeArea;
};

export type SnapshotNote = {
  id: string;
  title: string;
  lifeArea: EntityLifeArea;
};

export type SnapshotEntities = {
  today: string;
  tasks: SnapshotTask[];
  projects: SnapshotProject[];
  goals: SnapshotGoal[];
  habits: SnapshotHabit[];
  notes: SnapshotNote[];
};

function lifeViewFromArea(area: EntityLifeArea): LifeView {
  if (area === "work") return "work";
  if (area === "personal") return "personal";
  return "both";
}

export function entityFocusHref(
  kind: EntityKind,
  id: string,
  data: SnapshotEntities,
): string | null {
  switch (kind) {
    case "project": {
      const p = data.projects.find((x) => x.id === id);
      if (!p) return null;
      return hrefWithLife(
        `/projects?project=${id}`,
        lifeViewFromArea(p.lifeArea),
      );
    }
    case "goal": {
      const g = data.goals.find((x) => x.id === id);
      if (!g) return null;
      return hrefWithLife(`/goals?goal=${id}`, lifeViewFromArea(g.lifeArea));
    }
    case "habit": {
      const h = data.habits.find((x) => x.id === id);
      if (!h) return null;
      return hrefWithLife(`/habits?habit=${id}`, lifeViewFromArea(h.lifeArea));
    }
    case "note": {
      const n = data.notes.find((x) => x.id === id);
      if (!n) return null;
      return hrefWithLife(`/notes/${id}`, lifeViewFromArea(n.lifeArea));
    }
    case "task": {
      const t = data.tasks.find((x) => x.id === id);
      if (!t) return null;
      return taskDetailHref(
        { id: t.id, due: t.due } as Parameters<typeof taskDetailHref>[0],
        lifeViewFromArea(t.lifeArea),
        data.today,
      );
    }
  }
}

const FOCUS_PARAM = /[?&](task|project|goal|habit)=/;
const NOTE_PATH = /^\/notes\/[^/?#]+/;

export function hrefHasEntityFocus(href: string): boolean {
  return FOCUS_PARAM.test(href) || NOTE_PATH.test(href);
}

function norm(s: string): string {
  return s.trim().toLowerCase();
}

export function resolveEntityFromLabel(
  label: string,
  data: SnapshotEntities,
): { kind: EntityKind; id: string } | null {
  const key = norm(label);
  if (!key) return null;

  const task = data.tasks.find((t) => norm(t.title) === key);
  if (task) return { kind: "task", id: task.id };

  const project = data.projects.find((p) => norm(p.title) === key);
  if (project) return { kind: "project", id: project.id };

  const goal = data.goals.find((g) => norm(g.title) === key);
  if (goal) return { kind: "goal", id: goal.id };

  const habit = data.habits.find((h) => norm(h.name) === key);
  if (habit) return { kind: "habit", id: habit.id };

  const note = data.notes.find((n) => norm(n.title) === key);
  if (note) return { kind: "note", id: note.id };

  return null;
}

export function resolveFocusHref(
  item: {
    label: string;
    href?: string | null;
    /** "none" and "" both mean "not an entity" — the schema's sentinel. */
    entityKind?: EntityKind | "none" | "" | null;
    entityId?: string | null;
  },
  data: SnapshotEntities,
): string | null {
  if (item.entityKind && item.entityKind !== "none" && item.entityId) {
    const fromEntity = entityFocusHref(item.entityKind, item.entityId, data);
    if (fromEntity) return fromEntity;
  }

  const href = item.href?.trim();
  if (href && href.startsWith("/") && hrefHasEntityFocus(href)) {
    return href;
  }

  const matched = resolveEntityFromLabel(item.label, data);
  if (matched) {
    const focused = entityFocusHref(matched.kind, matched.id, data);
    if (focused) return focused;
  }

  if (href && href.startsWith("/")) return href;
  return null;
}

export function normalizeInAppHref(href?: string | null): string | null {
  if (!href) return null;
  const h = href.trim();
  if (!h || h.startsWith("http://") || h.startsWith("https://")) return null;
  return h.startsWith("/") ? h : `/${h}`;
}
