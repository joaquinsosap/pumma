import type { LifeArea, LifeView } from "@/lib/types";

export type { LifeArea, LifeView };

// Renamed with the move to pumma.app. Cookies are per-origin, so nothing
// carried over from the old host anyway — this was the one moment the rename
// cost nothing.
export const LIFE_AREA_COOKIE = "pumma-life";
export const DEFAULT_LIFE_VIEW: LifeView = "both";

export function parseLifeView(value?: string | null): LifeView {
  if (value === "work") return "work";
  if (value === "personal") return "personal";
  return "both";
}

/** @deprecated use parseLifeView */
export const parseLifeArea = parseLifeView;

export function filterByLifeView<T extends { lifeArea: LifeArea | "both" }>(
  items: T[],
  view: LifeView
): T[] {
  if (view === "both") return items;
  // An item tagged lifeArea "both" (tasks/notes only) shows in every view.
  return items.filter((item) => item.lifeArea === view || item.lifeArea === "both");
}

/** @deprecated use filterByLifeView */
export const filterByLifeArea = filterByLifeView;

/**
 * Goals filter on lifeArea like everything else now that they carry tags —
 * a goal tagged both shows in every view while still living in one column.
 */
export function filterGoalsByLifeView<
  T extends { lifeArea: LifeArea | "both" },
>(goals: T[], view: LifeView): T[] {
  return filterByLifeView(goals, view);
}

export function lifeAreaForCreate(view: LifeView): LifeArea {
  return view === "work" ? "work" : "personal";
}

export function hrefWithLife(path: string, view: LifeView) {
  const params = new URLSearchParams();
  params.set("life", view);
  const [base, existing] = path.split("?");
  const merged = new URLSearchParams(existing);
  params.forEach((value, key) => merged.set(key, value));
  return `${base}?${merged.toString()}`;
}
