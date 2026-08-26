"use client";
import { DeleteButton } from "@/components/ui/delete-button";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { useTheme } from "next-themes";
import type { CalendarFeed, Settings, Tag } from "@/lib/schemas";
import {
  PRIORITY_LABELS,
  STATUS_LABELS,
  TASK_PRIORITIES,
  TASK_STATUSES,
  toggleFilterValue,
} from "@/lib/task-filters";
import {
  updateSettingsAction,
  setTheme,
  addTagAction,
  updateUserNameAction,
} from "@/lib/actions/settings";
import {
  deleteTagAction,
  reorderTagsAction,
  updateTagAction,
} from "@/lib/actions/tags";
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { GripVertical } from "@/components/icons";
import { sortTags, TAG_SORTS, type TagSort } from "@/lib/collection-sort";
import { isBuiltInTag, tagDeleteBlock } from "@/lib/tag-protection";
import { SortMenu } from "@/components/ui/sort-menu";
import { CleanTagsButton } from "@/components/tags/CleanTagsButton";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { SignOutButton } from "@/components/auth/SignOutButton";
import { toast } from "sonner";
import { TAG_PALETTE } from "@/lib/types";
import { Topbar } from "@/components/shell/Topbar";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useState, useEffect, useRef, type ReactNode } from "react";
import type { OmniType } from "@/lib/types";
import { LIFE_SPAN_DEFAULT, LIFE_SPAN_MAX } from "@/lib/date";
import {
  DEFAULT_HABIT_VISIBILITY,
  HABIT_VISIBILITY_DEFAULTS,
} from "@/lib/habit-visibility";
import { SettingsNumberField } from "@/components/settings/SettingsNumberField";
import { TimezoneSelect } from "@/components/settings/TimezoneSelect";
import { SubscriptionCard } from "@/components/settings/SubscriptionCard";
import { AssistantProviderFields } from "@/components/settings/AssistantProviderFields";
import { DataSection } from "@/components/settings/DataSection";
import { ReplayTutorialButton } from "@/components/settings/ReplayTutorialButton";
import type { DeleteAccountBlock } from "@/lib/actions/account";
import type { StarterStatus } from "@/lib/actions/starter";
import { DueQuickPick } from "@/components/shell/DueQuickPick";
import { CalendarFeeds } from "@/components/settings/CalendarFeeds";
import { cn } from "@/lib/utils";
import {
  SettingsGroupBlock,
  SettingsNav,
  type SettingsGroup,
} from "@/components/settings/SettingsNav";

type Props = {
  settings: Settings | null;
  userName: string;
  userEmail: string | null;
  authEnabled: boolean;
  // Hosted deployments with an active subscription show the billing card.
  showSubscription?: boolean;
  /** Set when a live subscription has to be cancelled before deleting. */
  deletionBlock?: DeleteAccountBlock | null;
  /** Null once the day-one examples are gone, which hides the offer. */
  starter?: StarterStatus | null;
  /** Uses per tag, for the "Most used" sort. */
  tagCounts?: Record<string, number>;
  tags: Tag[];
  stats: { dayPct: number; habitsLabel: string; topStreak: number };
  /** Subscribed calendars, managed here and nowhere else. */
  calendarFeeds?: CalendarFeed[];
};

function SettingRow({
  label,
  description,
  children,
}: {
  label: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    // Capped, and the control sits at the end of the TEXT rather than the far
    // edge of the panel. Full width, a toggle ended up an inch of white away
    // from the sentence it belongs to, and on a wide screen you genuinely
    // cannot tell whether it lines up with this row or the next one.
    <div className="flex max-w-2xl items-center justify-between gap-6 border-b border-border/60 py-3 first:pt-0 last:border-0 last:pb-0">
      <div className="min-w-0 flex-1">
        <div className="text-sm text-ink">{label}</div>
        {description ? (
          <p className="mt-0.5 text-[12px] leading-snug text-faint">
            {description}
          </p>
        ) : null}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function SettingsSection({
  title,
  description,
  children,
  className,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn(
        "rounded-[13px] border border-border bg-surface p-5",
        className,
      )}
    >
      <h3 className="text-sm font-bold">{title}</h3>
      {description ? (
        <p className="mt-1 mb-3 text-[12px] text-faint">{description}</p>
      ) : (
        <div className="mb-4" />
      )}
      {children}
    </section>
  );
}

export function SettingsView({
  settings,
  userName,
  userEmail,
  authEnabled,
  showSubscription = false,
  deletionBlock = null,
  starter = null,
  tags,
  tagCounts = {},
  stats,
  calendarFeeds = [],
}: Props) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const { setTheme: setLocal } = useTheme();
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [tagName, setTagName] = useState("");
  const [name, setName] = useState(userName);

  // Tag ordering. The chosen sort applies instantly and persists behind; a
  // drag both rearranges and IS the act of choosing "custom", so it flips the
  // menu without a click. `draggedIds` holds the arrangement the hand just
  // made until the server echoes it back.
  const [tagSort, setTagSortState] = useState<TagSort>(
    settings?.tagSort ?? "custom",
  );
  useEffect(() => {
    setTagSortState(settings?.tagSort ?? "custom");
  }, [settings?.tagSort]);
  const [draggedIds, setDraggedIds] = useState<string[] | null>(null);
  const changeTagSort = (next: TagSort) => {
    setTagSortState(next);
    void updateSettingsAction({ tagSort: next });
  };

  const countsMap = new Map(Object.entries(tagCounts));
  const sortedTags = (() => {
    const base = sortTags(tags, tagSort, countsMap);
    if (tagSort !== "custom" || !draggedIds) return base;
    const rank = new Map(draggedIds.map((id, i) => [id, i]));
    return [...base].sort(
      (a, b) => (rank.get(a.id) ?? 1e9) - (rank.get(b.id) ?? 1e9),
    );
  })();

  const tagDragSensors = useSensors(
    // A little travel before a drag starts, so clicking the name to rename or
    // the dot to recolour stays a click.
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  );
  const handleTagDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const ids = sortedTags.map((t) => t.id);
    const from = ids.indexOf(String(active.id));
    const to = ids.indexOf(String(over.id));
    if (from < 0 || to < 0) return;
    const next = arrayMove(ids, from, to);
    setDraggedIds(next);
    setTagSortState("custom");
    startTransition(async () => {
      const res = await reorderTagsAction(next);
      if (!res.ok) toast.error(res.error ?? "Could not save that order");
      router.refresh();
    });
  };

  useEffect(() => {
    setName(userName);
  }, [userName]);

  const saveName = () => {
    const trimmed = name.trim();
    if (!trimmed || trimmed === userName) {
      setName(userName);
      return;
    }
    startTransition(async () => {
      await updateUserNameAction(trimmed);
      router.refresh();
    });
  };

  const update = (patch: Parameters<typeof updateSettingsAction>[0]) => {
    startTransition(async () => {
      await updateSettingsAction(patch);
      router.refresh();
    });
  };

  const toggleTheme = () => {
    const next = settings?.theme === "dark" ? "light" : "dark";
    setLocal(next);
    startTransition(async () => {
      await setTheme(next);
      router.refresh();
    });
  };

  return (
    <>
      <Topbar
        title="Settings"
        dayPct={stats.dayPct}
        habitsLabel={stats.habitsLabel}
        topStreak={stats.topStreak}
        birthDate={settings?.birthDate ?? null}
        lifeSpanYears={settings?.lifeSpanYears}
      />
      <div
        ref={scrollerRef}
        className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden pb-6 max-lg:pb-28 animate-pumma-view"
      >
        {/* Masonry, not a grid. These panels have wildly different heights
            (General and Life areas are tall, Habits and Life calendar are
            short), and a two-column GRID makes every row as tall as its
            tallest cell, so a short panel next to a tall one left half a
            screen of white. CSS columns let the short ones stack up under
            each other and fill it. break-inside-avoid keeps a panel whole,
            and the margin lives on the children because columns have no
            row-gap. One column below lg, where the question does not arise. */}
        <div className="lg:grid lg:grid-cols-[40px_minmax(0,1fr)] lg:gap-8">
          {/* Sticky, because the point of an index is being reachable
              from anywhere in the thing it indexes. Hidden below lg,
              where the page is one column and short enough to scroll. */}
          <SettingsNav
            groups={SETTINGS_GROUPS}
            scrollerRef={scrollerRef}
            className="sticky top-2 hidden self-start lg:block"
          />
          <div className="flex flex-col gap-8">
            <SettingsGroupBlock id="account" label="Account">
          <SettingsSection title="Profile" className="mb-6">
              <div className="grid gap-6 lg:grid-cols-2">
                <label className="block">
                  <span className="mb-1 block text-sm text-muted">
                    Display name
                  </span>
                  <Input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    onBlur={saveName}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") e.currentTarget.blur();
                    }}
                    placeholder="Your name"
                    maxLength={64}
                  />
                  <p className="mt-1.5 text-[12px] text-faint">
                    Used in the sidebar and home greeting.
                  </p>
                </label>
                <div className="flex flex-col rounded-lg border border-border/70 bg-background/40 p-4">
                  <p className="text-[12px] font-medium text-muted">Account</p>
                  {authEnabled ? (
                    <>
                      <p className="mt-2 truncate text-sm text-ink">
                        {userEmail ?? userName}
                      </p>
                      <p className="mt-1 text-[12px] leading-relaxed text-faint">
                        Signed in. Ending your session returns you to the login
                        screen.
                      </p>
                      <SignOutButton variant="button" className="mt-3 w-full" />
                    </>
                  ) : (
                    <>
                      <p className="mt-2 text-sm text-ink">{userName}</p>
                      <p className="mt-1 text-[12px] leading-relaxed text-faint">
                        Local demo profile. Name updates apply across the app
                        immediately.
                      </p>
                    </>
                  )}
                </div>
              </div>
          </SettingsSection>

            <div className="gap-6 lg:columns-2 [&>*]:mb-6 [&>*]:break-inside-avoid">
            <SettingsSection
              title="Assistant"
              description="Plan and Ask call the AI provider you choose, with your own key. It's stored encrypted and used only for your requests."
            >
              <AssistantProviderFields
                provider={settings?.aiProvider ?? null}
                model={settings?.aiModel ?? null}
                last4={settings?.aiApiKeyLast4 ?? null}
              />
            </SettingsSection>

            <SettingsSection
              title="Tour"
              description="The sixty seconds you watched on your first day. Worth another look after a while away, since it covers the things that aren't buttons."
            >
              <ReplayTutorialButton />
            </SettingsSection>

            {showSubscription && (
              <SettingsSection
                title="Subscription"
                description="Your hosted PUMMA plan. Payments are handled by the billing provider, and this app never sees your card."
                >
                <SubscriptionCard />
              </SettingsSection>
            )}

            </div>
            </SettingsGroupBlock>

            <SettingsGroupBlock id="appearance" label="Appearance">
            <SettingsSection
              title="General"
              description="App-wide preferences for appearance, calendar, and quick capture."
            >
              <SettingRow
                label="Dark mode"
                description="Use the dark color theme across the app."
              >
                <Switch
                  checked={settings?.theme === "dark"}
                  onCheckedChange={toggleTheme}
                />
              </SettingRow>
              <SettingRow
                label="Week starts on Sunday"
                description="Affects the tasks calendar and week-based views."
              >
                <Switch
                  checked={settings?.weekStart === "sun"}
                  onCheckedChange={(v) =>
                    update({ weekStart: v ? "sun" : "mon" })
                  }
                />
              </SettingRow>
              <SettingRow
                label="Type dates month-first"
                description={
                  settings?.dateOrder === "mdy"
                    ? "“#8/7” in the capture bar means 7 August."
                    : "“#8/7” in the capture bar means 8 July."
                }
              >
                <Switch
                  checked={settings?.dateOrder === "mdy"}
                  onCheckedChange={(v) =>
                    update({ dateOrder: v ? "mdy" : "dmy" })
                  }
                />
              </SettingRow>
              <div className="border-t border-border/60 py-3">
                <label className="mb-1.5 block text-sm text-ink">Timezone</label>
                <p className="mb-2 text-[12px] text-faint">
                  Used for today, due dates, habits, calendar, and greetings
                  across the app.
                </p>
                <TimezoneSelect
                  value={settings?.timezone ?? "UTC"}
                  onChange={(timezone) => update({ timezone })}
                />
              </div>
            </SettingsSection>

            </SettingsGroupBlock>

            <SettingsGroupBlock id="defaults" label="Defaults">
          <SettingsSection
            className="mb-6"
            title="Defaults"
            description="Where each surface starts. A link that names a view, like Home’s Today, still wins."
          >
            <SettingRow
              label="Default due today"
              description="New tasks from quick capture default to today."
            >
              <Switch
                checked={settings?.defaultDueToday ?? true}
                onCheckedChange={(v) => update({ defaultDueToday: v })}
              />
            </SettingRow>
            {/* Across the width, not down a narrow column. This panel is
                full width because its copy needs the room, and stacking
                four short controls under that copy just moved the empty
                space from beside the panel to inside it. */}
            <div className="grid gap-x-8 gap-y-5 border-t border-border/60 pt-4 sm:grid-cols-2 xl:grid-cols-3">
              <div>
                <label className="mb-1.5 block text-sm text-ink">
                  Default capture type
                </label>
                <p className="mb-2 text-[12px] text-faint">
                  What the omnibar creates when you don&apos;t pick a type.
                </p>
                <select
                  className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm"
                  value={settings?.defaultCaptureType ?? "task"}
                  onChange={(e) =>
                    update({ defaultCaptureType: e.target.value as OmniType })
                  }
                >
                  <option value="task">Task</option>
                  <option value="habit">Habit</option>
                  <option value="goal">Goal</option>
                  <option value="note">Note</option>
                </select>
              </div>
              <div>
                <label className="mb-1.5 block text-sm text-ink">
                  Tasks page opens on
                </label>
                <p className="mb-2 text-[12px] text-faint">
                  Links that name a view (Home&apos;s &quot;Today&quot;) still
                  win.
                </p>
                <div className="flex flex-wrap gap-4">
                  <select
                    aria-label="Default tasks view"
                    className="rounded-lg border border-border bg-surface px-3 py-2 text-sm"
                    value={settings?.defaultTasksTab ?? "all"}
                    onChange={(e) =>
                      update({
                        defaultTasksTab: e.target
                          .value as Settings["defaultTasksTab"],
                      })
                    }
                  >
                    <option value="today">Today</option>
                    <option value="upcoming">Upcoming</option>
                    <option value="all">All</option>
                  </select>
                  <select
                    aria-label="Default grouping"
                    className="rounded-lg border border-border bg-surface px-3 py-2 text-sm"
                    value={settings?.defaultTasksGroup ?? "none"}
                    onChange={(e) =>
                      update({
                        defaultTasksGroup: e.target
                          .value as Settings["defaultTasksGroup"],
                      })
                    }
                  >
                    <option value="none">No grouping</option>
                    <option value="tag">Group by tag</option>
                    <option value="project">Group by project</option>
                  </select>
                </div>
              </div>
              <div>
                <label className="mb-1.5 block text-sm text-ink">
                  Tasks page starts filtered by
                </label>
                <p className="mb-2 text-[12px] text-faint">
                  Leave both empty to show everything. Tag filters stay
                  per-visit: they change too often to be a default.
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {TASK_STATUSES.map((v) => (
                    <FilterDefaultChip
                      key={v}
                      label={STATUS_LABELS[v]}
                      on={(settings?.defaultTasksStatus ?? []).includes(v)}
                      onClick={() =>
                        update({
                          defaultTasksStatus: toggleFilterValue(
                            settings?.defaultTasksStatus ?? [],
                            v,
                            TASK_STATUSES,
                          ),
                        })
                      }
                    />
                  ))}
                  <span className="mx-1 w-px self-stretch bg-border" />
                  {TASK_PRIORITIES.map((v) => (
                    <FilterDefaultChip
                      key={v}
                      label={PRIORITY_LABELS[v]}
                      on={(settings?.defaultTasksPriority ?? []).includes(v)}
                      onClick={() =>
                        update({
                          defaultTasksPriority: toggleFilterValue(
                            settings?.defaultTasksPriority ?? [],
                            v,
                            TASK_PRIORITIES,
                          ),
                        })
                      }
                    />
                  ))}
                </div>
              </div>
              <div>
                <label className="mb-1.5 block text-sm text-ink">
                  New habits repeat
                </label>
                <p className="mb-2 text-[12px] text-faint">
                  The cadence a freshly captured habit starts with.
                </p>
                <select
                  className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm"
                  value={settings?.defaultHabitFrequency ?? "daily"}
                  onChange={(e) =>
                    update({
                      defaultHabitFrequency: e.target
                        .value as Settings["defaultHabitFrequency"],
                    })
                  }
                >
                  <option value="daily">Daily</option>
                  <option value="weekly">Weekly</option>
                  <option value="monthly">Monthly</option>
                </select>
              </div>
            </div>
          </SettingsSection>

            </SettingsGroupBlock>

            <SettingsGroupBlock id="workspace" label="Workspace">
            {/* Full width: a list of subscriptions plus the "where do I find
                the link" answer needs the room, and it is the one panel here
                somebody arrives at with a task in hand. */}
            <div className="mb-6">
              <SettingsSection
                title="Linked calendars"
                description="Read events from Google, Outlook, Office 365, Apple or anything else that publishes an .ics link."
              >
                <CalendarFeeds feeds={calendarFeeds} />
                <div className="mt-4 border-t border-border2 pt-3">
                  <SettingRow
                    label="Show meeting ID and passcode"
                    description="Under each meeting, for dialling in by phone or reading a code out. Off by default: the join button already carries both."
                  >
                    <Switch
                      checked={settings?.showMeetingCodes ?? false}
                      onCheckedChange={(v) => update({ showMeetingCodes: v })}
                    />
                  </SettingRow>
                </div>
              </SettingsSection>
            </div>

            {/* Explicit columns, not a packer. CSS columns balance by
                height, so it kept putting Habits beside Life calendar and
                Life areas underneath. These three have an arrangement that
                is meant: the two short view settings stack together, and
                the tall schedule sits beside them. */}
            <div className="grid gap-6 lg:grid-cols-2 lg:items-start">
              <div className="flex flex-col gap-6">
              <SettingsSection
                title="Life calendar"
                description="Birth date, span, and how the life grid is displayed."
              >
                <SettingRow
                  label="Full view"
                  description="Fit your entire life grid in the viewport with a simplified two-color layout."
                >
                  <Switch
                    checked={settings?.lifeCalendarFullView ?? false}
                    onCheckedChange={(v) => update({ lifeCalendarFullView: v })}
                  />
                </SettingRow>
                <div className="mt-3 grid gap-4 sm:grid-cols-2">
                  <label className="block">
                    <span className="mb-1 block text-sm text-muted">
                      Birth date
                    </span>
                    <DueQuickPick
                      mode="birth"
                      value={settings?.birthDate ?? null}
                      onChange={(next) => {
                        if (next) update({ birthDate: next });
                      }}
                    />
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-sm text-muted">
                      Life span (years, max {LIFE_SPAN_MAX})
                    </span>
                    <input
                      type="number"
                      min={1}
                      max={LIFE_SPAN_MAX}
                      className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm"
                      value={settings?.lifeSpanYears ?? LIFE_SPAN_DEFAULT}
                      onChange={(e) =>
                        update({
                          lifeSpanYears: Math.min(
                            LIFE_SPAN_MAX,
                            Math.max(
                              1,
                              Number(e.target.value) || LIFE_SPAN_DEFAULT,
                            ),
                          ),
                        })
                      }
                    />
                  </label>
                </div>
              </SettingsSection>

              <SettingsSection
                title="Habits"
                description="How many squares each habit heatmap shows, by cadence."
              >
                <div className="grid gap-4 sm:grid-cols-3">
                  <div>
                    <span className="mb-1 block text-sm text-muted">
                      Daily habits
                    </span>
                    <SettingsNumberField
                      value={
                        settings?.habitVisibleDays ??
                        DEFAULT_HABIT_VISIBILITY.dailyDays
                      }
                      suffix="days"
                      hint={`Default ${HABIT_VISIBILITY_DEFAULTS.dailyDays.default} days`}
                      onSave={(habitVisibleDays) => update({ habitVisibleDays })}
                    />
                  </div>
                  <div>
                    <span className="mb-1 block text-sm text-muted">
                      Weekly habits
                    </span>
                    <SettingsNumberField
                      value={
                        settings?.habitVisibleWeeks ??
                        DEFAULT_HABIT_VISIBILITY.weeklyWeeks
                      }
                      suffix="weeks"
                      hint={`Default ${HABIT_VISIBILITY_DEFAULTS.weeklyWeeks.default} weeks (2 months)`}
                      onSave={(habitVisibleWeeks) => update({ habitVisibleWeeks })}
                    />
                  </div>
                  <div>
                    <span className="mb-1 block text-sm text-muted">
                      Monthly habits
                    </span>
                    <SettingsNumberField
                      value={
                        settings?.habitVisibleMonths ??
                        DEFAULT_HABIT_VISIBILITY.monthlyMonths
                      }
                      suffix="months"
                      hint={`Default ${HABIT_VISIBILITY_DEFAULTS.monthlyMonths.default} months`}
                      onSave={(habitVisibleMonths) =>
                        update({ habitVisibleMonths })
                      }
                    />
                  </div>
                </div>
              </SettingsSection>

              </div>
              <div className="flex flex-col gap-6">
              <SettingsSection
                title="Life areas"
                description="Automatically switch the sidebar Personal/Work toggle with your working hours."
              >
                <SettingRow
                  label="Auto switch"
                  description="Work during working hours, Personal outside them. A manual pick holds for the override window below."
                >
                  <Switch
                    checked={settings?.lifeAutoSwitch ?? false}
                    onCheckedChange={(v) => update({ lifeAutoSwitch: v })}
                  />
                </SettingRow>
                <div className="grid gap-4 border-t border-border/60 pt-3 sm:grid-cols-2">
                  <label className="block">
                    <span className="mb-1 block text-sm text-muted">
                      Work starts
                    </span>
                    <input
                      type="time"
                      value={settings?.workStart ?? "09:00"}
                      onChange={(e) => {
                        if (e.target.value) update({ workStart: e.target.value });
                      }}
                      className="w-full rounded-lg border border-border bg-surface px-3 py-2 font-mono text-sm"
                    />
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-sm text-muted">Work ends</span>
                    <input
                      type="time"
                      value={settings?.workEnd ?? "18:00"}
                      onChange={(e) => {
                        if (e.target.value) update({ workEnd: e.target.value });
                      }}
                      className="w-full rounded-lg border border-border bg-surface px-3 py-2 font-mono text-sm"
                    />
                  </label>
                </div>
                <div className="mt-4">
                  <span className="mb-1.5 block text-sm text-muted">Work days</span>
                  <WorkDaysPicker
                    value={settings?.workDays ?? [1, 2, 3, 4, 5]}
                    onChange={(workDays) => update({ workDays })}
                  />
                </div>
                <div className="mt-4 max-w-[220px]">
                  <span className="mb-1 block text-sm text-muted">
                    Manual override lasts
                  </span>
                  <SettingsNumberField
                    value={settings?.lifeAutoOverrideMins ?? 60}
                    suffix="min"
                    hint="Then the schedule takes back over"
                    onSave={(lifeAutoOverrideMins) =>
                      update({ lifeAutoOverrideMins })
                    }
                  />
                </div>
              </SettingsSection>
              </div>
            </div>
            </SettingsGroupBlock>

            <SettingsGroupBlock id="tags" label="Tags">
            <SettingsSection title="Tags" className="mb-6">
              <div className="mb-3 flex items-center justify-between gap-3">
                <p className="m-0 text-[12px] text-faint">
                  Click the dot to change a tag&apos;s color, click the name to
                  rename. Drag the handle to arrange them yourself — the sidebar
                  follows this order.
                </p>
                <SortMenu
                  options={TAG_SORTS}
                  value={tagSort}
                  onChange={changeTagSort}
                />
              </div>
            <DndContext
              sensors={tagDragSensors}
              collisionDetection={closestCenter}
              onDragEnd={handleTagDragEnd}
            >
              <SortableContext
                items={sortedTags.map((t) => t.id)}
                strategy={rectSortingStrategy}
              >
                <div className="mb-4 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                  {sortedTags.map((t) => (
                    <SortableTagRow key={t.id} tag={t} />
                  ))}
                </div>
              </SortableContext>
            </DndContext>
            <div className="flex max-w-xl gap-2">
              <Input
                value={tagName}
                onChange={(e) => setTagName(e.target.value)}
                placeholder="New tag name"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && tagName.trim()) {
                    startTransition(async () => {
                      await addTagAction(tagName);
                      setTagName("");
                      router.refresh();
                    });
                  }
                }}
              />
              <Button
                onClick={() =>
                  startTransition(async () => {
                    await addTagAction(tagName);
                    setTagName("");
                    router.refresh();
                  })
                }
              >
                Add
              </Button>
            </div>

            <div className="mt-5 border-t border-border/60 pt-4">
              <SettingRow
                label="Number keys jump between spaces"
                description="1 Home, 2 Tasks, 3 Notes, and on down the sidebar. While this is on, a capture cannot start with a digit, the key goes to the sidebar instead. Everything after the first character still goes to the bar."
              >
                <Switch
                  checked={settings?.spaceShortcuts ?? true}
                  onCheckedChange={(v) => update({ spaceShortcuts: v })}
                />
              </SettingRow>

              <p className="mb-3 mt-4 font-mono text-[10px] font-semibold uppercase tracking-widest text-faint2">
                Housekeeping
              </p>
              <SettingRow
                label="Auto-clean unused tags"
                description="Once a day, remove tags that nothing references and that are older than the window below. Off by default."
              >
                <Switch
                  checked={settings?.tagAutoClean ?? false}
                  onCheckedChange={(v) => update({ tagAutoClean: v })}
                />
              </SettingRow>
              {settings?.tagAutoClean && (
                <div className="border-t border-border/60 py-3">
                  <label className="mb-1.5 block text-sm text-ink">
                    Only clean tags unused for
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      min={1}
                      max={365}
                      className="w-24 rounded-lg border border-border bg-surface px-3 py-2 text-sm"
                      value={settings?.tagAutoCleanDays ?? 30}
                      onChange={(e) =>
                        update({
                          tagAutoCleanDays: Math.min(
                            365,
                            Math.max(1, Number(e.target.value) || 30),
                          ),
                        })
                      }
                    />
                    <span className="text-sm text-muted">days</span>
                  </div>
                </div>
              )}
              <div className="border-t border-border/60 pt-3">
                <p className="mb-2 text-[12px] leading-relaxed text-faint">
                  Or clean once, right now. You can undo it straight after.
                </p>
                <CleanTagsButton />
              </div>
            </div>
          </SettingsSection>
            </SettingsGroupBlock>

            <SettingsGroupBlock id="data" label="Data">
          <SettingsSection
            className="mb-6"
            title="Data"
            description="Take a copy with you, or close the account for good."
          >
            <DataSection
              userEmail={userEmail}
              deletionBlock={deletionBlock}
              starter={starter}
            />
          </SettingsSection>

            </SettingsGroupBlock>

          </div>
        </div>
      </div>
    </>
  );
}

/**
 * The order Settings reads in, top to bottom.
 *
 * Grouped by what you are trying to change rather than by which component
 * owns it: who you are, how it looks, where things start, the shape of the
 * workspace, then the two that are their own errands. Eleven panels in one
 * undifferentiated scroll meant the only way to find anything was to read
 * everything.
 */
const SETTINGS_GROUPS: SettingsGroup[] = [
  { id: "account", label: "Account", short: "Account" },
  { id: "appearance", label: "Appearance", short: "Appearance" },
  { id: "defaults", label: "Defaults", short: "Defaults" },
  { id: "workspace", label: "Workspace", short: "Workspace" },
  { id: "tags", label: "Tags", short: "Tags" },
  { id: "data", label: "Data", short: "Data" },
];

/** Mon-first weekday toggles for the auto-switch schedule (values = JS getDay). */
const WORKDAY_ORDER: { day: number; label: string }[] = [
  { day: 1, label: "M" },
  { day: 2, label: "T" },
  { day: 3, label: "W" },
  { day: 4, label: "T" },
  { day: 5, label: "F" },
  { day: 6, label: "S" },
  { day: 0, label: "S" },
];

function WorkDaysPicker({
  value,
  onChange,
}: {
  value: number[];
  onChange: (days: number[]) => void;
}) {
  const toggle = (day: number) => {
    const next = value.includes(day)
      ? value.filter((d) => d !== day)
      : [...value, day];
    onChange(next.sort((a, b) => a - b));
  };
  return (
    <div className="flex gap-1">
      {WORKDAY_ORDER.map(({ day, label }, i) => {
        const active = value.includes(day);
        return (
          <button
            key={`${day}-${i}`}
            type="button"
            onClick={() => toggle(day)}
            aria-pressed={active}
            className={cn(
              "h-8 w-8 rounded-lg border font-mono text-[11px] font-bold transition-colors",
              active
                ? "border-ink bg-ink text-background"
                : "border-border bg-surface2 text-faint hover:border-faint hover:text-ink",
            )}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}

/** Editable tag row: cycle color via the dot, rename inline, delete (non-default). */
/**
 * A TagRow that can be picked up. The handle is the only drag surface, so the
 * rename input and colour dot keep working as plain clicks; while a row is in
 * flight it goes translucent and its neighbours shuffle around it.
 */
function SortableTagRow({ tag }: { tag: Tag }) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: tag.id });
  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition: transition ?? undefined,
      }}
      className={cn(isDragging && "z-10 opacity-60")}
    >
      <TagRow
        tag={tag}
        handle={
          <button
            type="button"
            aria-label={`Reorder ${tag.name}`}
            className="-ml-1 shrink-0 cursor-grab touch-none rounded p-0.5 text-faint2 transition-colors hover:text-faint active:cursor-grabbing"
            {...attributes}
            {...listeners}
          >
            <GripVertical className="h-3.5 w-3.5" />
          </button>
        }
      />
    </div>
  );
}

function TagRow({ tag, handle }: { tag: Tag; handle?: ReactNode }) {
  const blocked = tagDeleteBlock(tag);
  const [, startTransition] = useTransition();
  const confirm = useConfirm();
  const [draft, setDraft] = useState(tag.name);

  useEffect(() => setDraft(tag.name), [tag.name]);

  const cycleColor = () => {
    const idx = TAG_PALETTE.indexOf(tag.color as (typeof TAG_PALETTE)[number]);
    const next = TAG_PALETTE[(idx + 1) % TAG_PALETTE.length];
    startTransition(async () => {
      const res = await updateTagAction({ id: tag.id, color: next });
      if (!res.ok) toast.error(res.error ?? "Could not update color");
    });
  };

  const saveName = () => {
    const next = draft.trim().toLowerCase();
    if (!next || next === tag.name) {
      setDraft(tag.name);
      return;
    }
    startTransition(async () => {
      const res = await updateTagAction({ id: tag.id, name: next });
      if (!res.ok) {
        toast.error(res.error ?? "Could not rename tag");
        setDraft(tag.name);
      }
    });
  };

  const handleDelete = async () => {
    const ok = await confirm({
      title: `Delete tag "${tag.name}"?`,
      description: "It will be removed from every task and note that uses it.",
      confirmLabel: "Delete",
      destructive: true,
    });
    if (!ok) return;
    startTransition(async () => {
      const res = await deleteTagAction(tag.id);
      if (!res.ok) toast.error(res.error ?? "Could not delete tag");
      else toast.success("Tag deleted");
    });
  };

  return (
    <div className="group flex items-center gap-2 rounded-lg border border-border/70 bg-background/40 px-3 py-2 text-sm">
      {handle}
      <button
        type="button"
        onClick={cycleColor}
        className="h-3.5 w-3.5 shrink-0 rounded-full ring-offset-1 transition-transform hover:scale-125 focus-visible:ring-2 focus-visible:ring-faint"
        style={{ background: tag.color }}
        aria-label={`Change color of ${tag.name}`}
        title="Click to change color"
      />
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={saveName}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") {
            setDraft(tag.name);
            e.currentTarget.blur();
          }
        }}
        maxLength={40}
        aria-label={`Rename tag ${tag.name}`}
        className="min-w-0 flex-1 truncate rounded border border-transparent bg-transparent px-1 py-0.5 lowercase outline-none transition-colors hover:border-border focus:border-faint"
      />
      {/* One rule for the button and the server: a tag that cannot be
          deleted says why instead of offering a button that then refuses. */}
      {blocked ? (
        <span
          className="ml-auto shrink-0 font-mono text-[10px] text-faint"
          title={blocked}
        >
          {isBuiltInTag(tag) ? "built in" : "project"}
        </span>
      ) : (
        <DeleteButton
          onClick={handleDelete}
          label={`Delete tag ${tag.name}`}
          revealOnHover
          className="ml-auto"
        />
      )}
    </div>
  );
}

/**
 * One filter value, on or off, as a default rather than a live filter.
 *
 * Deliberately the same shape as the chips in the Filter menu: this sets
 * where that menu starts, so it should look like the thing it configures.
 */
function FilterDefaultChip({
  label,
  on,
  onClick,
}: {
  label: string;
  on: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cn(
        "rounded-[7px] border px-2.5 py-1 font-mono text-[11px] font-semibold transition-colors",
        on
          ? "border-primary bg-primary/[0.12] text-primary"
          : "border-border bg-surface text-muted hover:border-faint",
      )}
    >
      {label}
    </button>
  );
}
