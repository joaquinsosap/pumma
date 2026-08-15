"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  HomeTile,
  TasksTile,
  NotesTile,
  HabitsTile,
  GoalsTile,
  ProjectsTile,
  CalendarTile,
  LifeCalendarTile,
  AssistantTile,
  Settings,
} from "@/components/icons";
import { cn } from "@/lib/utils";
import { ThemeToggle } from "./ThemeToggle";
import { TagRail } from "./TagRail";
import {
  LifeAreaToggle,
  useLifeView,
  hrefWithAppParams,
  type LifeAutoConfig,
} from "./LifeAreaToggle";
import { SignOutButton } from "@/components/auth/SignOutButton";
import { PummaWordmark } from "@/components/shell/PummaWordmark";
import { PummaMark } from "@/components/shell/PummaMark";
import { AboutPummaButton } from "@/components/shell/AboutPummaButton";
import { DemoBanner } from "@/components/shell/DemoBanner";
import type { Tag, Task, Note } from "@/lib/schemas";
import { SPACE_SHORTCUTS } from "@/lib/space-shortcuts";

const nav = [
  {
    href: "/",
    label: "Home",
    icon: HomeTile,
    color: "text-primary",
    countKey: null,
  },
  {
    href: "/tasks",
    label: "Tasks",
    icon: TasksTile,
    color: "text-tasks",
    countKey: "openTasks" as const,
  },
  {
    href: "/notes",
    label: "Notes",
    icon: NotesTile,
    color: "text-notes",
    countKey: "notes" as const,
  },
  {
    href: "/habits",
    label: "Habits",
    icon: HabitsTile,
    color: "text-habits",
    countKey: "habits" as const,
  },
  {
    href: "/goals",
    label: "Goals",
    icon: GoalsTile,
    color: "text-goals",
    countKey: "goals" as const,
  },
  {
    href: "/projects",
    label: "Projects",
    icon: ProjectsTile,
    color: "text-projects",
    countKey: "projects" as const,
  },
  {
    href: "/calendar",
    label: "Calendar",
    icon: CalendarTile,
    color: "text-faint",
    countKey: null,
  },
  {
    href: "/life",
    label: "Life calendar",
    icon: LifeCalendarTile,
    color: "text-primary",
    countKey: null,
  },
  {
    href: "/assistant",
    label: "Assistant",
    icon: AssistantTile,
    color: "text-primary",
    countKey: null,
  },
];

type Counts = {
  openTasks: number;
  notes: number;
  habits: number;
  goals: number;
  projects: number;
};

type Props = {
  counts: Counts;
  tags: Tag[];
  tasks: Task[];
  notes: Note[];
  userName: string;
  authEnabled: boolean;
  lifeAuto: LifeAutoConfig;
  demo?: { expiresAt: string | null } | null;
  /** Show the number-key hint on hover. Off when the shortcut is disabled. */
  spaceShortcuts?: boolean;
  tagSort?: import("@/lib/collection-sort").TagSort;
};

export function Sidebar({
  counts,
  tags,
  tasks,
  notes,
  userName,
  authEnabled,
  lifeAuto,
  demo,
  spaceShortcuts = true,
  tagSort = "custom",
}: Props) {
  const pathname = usePathname();
  const [life] = useLifeView();

  return (
    <aside className="flex h-full min-h-0 w-[236px] shrink-0 flex-col border-r border-border bg-surface2 px-3 py-4">
      <div className="mb-3 flex shrink-0 items-center gap-2 px-2 py-1.5">
        <PummaMark className="h-7 w-7 shrink-0 rounded-lg" />
        <PummaWordmark className="text-[15px] font-bold tracking-tight" />
        <AboutPummaButton />
        <div className="ml-auto">
          <ThemeToggle />
        </div>
      </div>
      {demo && (
        <div className="mb-2 px-1">
          <DemoBanner expiresAt={demo.expiresAt} />
        </div>
      )}

      <LifeAreaToggle auto={lifeAuto} />

      <div className="shrink-0">
        <div className="px-2 pb-2 font-mono text-[10px] tracking-widest text-faint2">
          SPACES
        </div>
        <nav className="flex flex-col gap-px">
          {nav.map((item) => {
            const active =
              item.href === "/"
                ? pathname === "/"
                : pathname.startsWith(item.href);
            const Icon = item.icon;
            const count = item.countKey ? counts[item.countKey] : null;
            const shortcut = SPACE_SHORTCUTS.find(
              (sc) => sc.href === item.href,
            )?.key;
            return (
              <Link
                key={item.href}
                href={hrefWithAppParams(item.href, life)}
                className={cn(
                  "group flex items-center gap-[11px] rounded-lg px-2.5 py-2 text-[13.5px] text-muted transition-all duration-150 hover:translate-x-[2px] hover:bg-hover",
                  active && "bg-surface font-semibold text-ink shadow-sm",
                )}
              >
                <Icon
                  className={cn(
                    "h-[17px] w-[17px] transition-transform duration-150 group-hover:scale-110",
                    item.color,
                  )}
                  strokeWidth={2}
                />
                {item.label}
                <span className="ml-auto flex items-center gap-2">
                  {/* The key that gets you here, on hover only. A shortcut
                      nobody can find is a shortcut nobody uses, but nine
                      permanent digits down the sidebar is clutter you would
                      read every day to learn once. */}
                  {spaceShortcuts && shortcut && (
                    <kbd className="hidden font-mono text-[10px] text-faint2 group-hover:inline">
                      {shortcut}
                    </kbd>
                  )}
                  {count !== null && (
                    <span
                      className={cn(
                        "font-mono text-[11px] font-semibold",
                        item.countKey === "openTasks"
                          ? "text-tasks"
                          : "text-faint2",
                      )}
                    >
                      {count}
                    </span>
                  )}
                </span>
              </Link>
            );
          })}
        </nav>
      </div>

      <div className="mt-2 flex min-h-0 flex-1 flex-col overflow-hidden">
        <TagRail tags={tags} tasks={tasks} notes={notes} sort={tagSort} />
      </div>

      <div className="flex shrink-0 items-center gap-2.5 border-t border-border px-2.5 py-3">
        {/* No avatar: the app has no profile pictures, so a decorative blob
            just reads as a broken image. The name carries the identity. */}
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-muted">
          {userName}
        </span>
        <Link
          href={hrefWithAppParams("/settings", life)}
          title="Settings"
          className={cn(
            "flex h-7 w-7 shrink-0 items-center justify-center rounded-[7px] text-faint transition-colors hover:bg-hover hover:text-ink",
            pathname.startsWith("/settings") && "bg-surface text-ink shadow-sm",
          )}
        >
          <Settings className="h-4 w-4" strokeWidth={2} />
        </Link>
        {authEnabled && <SignOutButton variant="icon" />}
      </div>
    </aside>
  );
}
