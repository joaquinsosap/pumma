"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { greeting, iso } from "@/lib/date";
import { formatTopbarDateLine } from "@/lib/date-context";
import { DEFAULT_USER_NAME } from "@/lib/user-display";
import { ActiveTaskTimer } from "@/components/shell/ActiveTaskTimer";
import { TopbarProjectPill } from "@/components/shell/TopbarProjectPill";
import { useTimezone } from "@/components/shell/TimeZoneProvider";
import { useLifeView } from "@/components/shell/LifeAreaToggle";
import { hrefWithLife } from "@/lib/life-area";
import { cn } from "@/lib/utils";

type ActiveProject = {
  title: string;
  color: string;
  onClear?: () => void;
};

type Props = {
  title: string;
  dayPct: number;
  habitsLabel: string;
  topStreak: number;
  showGreeting?: boolean;
  userName?: string;
  activeProject?: ActiveProject;
  birthDate?: string | null;
  lifeSpanYears?: number;
};

export function Topbar({
  title,
  dayPct,
  habitsLabel,
  topStreak,
  showGreeting = false,
  userName = DEFAULT_USER_NAME,
  activeProject,
  birthDate = null,
  lifeSpanYears,
}: Props) {
  const timeZone = useTimezone();
  const now = new Date();
  const dateLine = formatTopbarDateLine(now, {
    birthDate,
    lifeSpanYears,
    timeZone,
  });

  // Where each stat goes. These used to be passed in, which meant only the
  // home page bothered — everywhere else the same three numbers sat there
  // looking identical and doing nothing. They are the same destinations on
  // every page, so the bar works them out itself.
  //
  // A stat pointing at the page you are already on stays plain text: a link
  // that goes nowhere is worse than no link, because you learn to distrust
  // the other two.
  const pathname = usePathname();
  const [life] = useLifeView();
  const linkTo = (path: string) => {
    const [base] = path.split("?");
    return base === pathname ? undefined : hrefWithLife(path, life);
  };
  const statLinks = {
    calendar: linkTo(`/calendar?day=${iso(now, timeZone)}`),
    dayDone: linkTo("/tasks?tab=today"),
    habits: linkTo("/habits"),
    streak: linkTo("/habits"),
  };

  return (
    <div className="mb-3 flex shrink-0 flex-col gap-2 sm:mb-4 sm:flex-row sm:items-end sm:justify-between sm:gap-0">
      <div className="min-w-0">
        {statLinks.calendar ? (
          <Link
            href={statLinks.calendar}
            className="mb-1 block max-w-[min(100%,52rem)] truncate font-mono text-[10px] leading-relaxed tracking-wide text-faint transition-colors hover:text-muted sm:text-[11px]"
          >
            {dateLine}
          </Link>
        ) : (
          <div className="mb-1 max-w-[min(100%,52rem)] truncate font-mono text-[10px] leading-relaxed tracking-wide text-faint sm:text-[11px]">
            {dateLine}
          </div>
        )}
        <div className="flex h-8 min-w-0 items-center gap-2.5 sm:h-9 sm:gap-3">
          <h1 className="m-0 min-w-0 truncate text-xl font-extrabold tracking-tight text-ink sm:shrink-0 sm:text-[26px]">
            {showGreeting ? greeting(userName, timeZone) : title}
          </h1>
          {activeProject ? (
            <TopbarProjectPill
              title={activeProject.title}
              color={activeProject.color}
              onClear={activeProject.onClear}
            />
          ) : null}
          <ActiveTaskTimer className="min-w-0 flex-1" />
        </div>
      </div>
      <div className="flex min-w-0 shrink items-center gap-1 self-stretch sm:self-auto">
        <Stat
          value={`${dayPct}`}
          suffix="%"
          label="DAY DONE"
          href={statLinks.dayDone}
        />
        <StatRule />
        <Stat
          value={habitsLabel}
          label="HABITS"
          className="text-habits"
          href={statLinks.habits}
        />
        <StatRule />
        <Stat value={`${topStreak}🔥`} label="STREAK" href={statLinks.streak} />
      </div>
    </div>
  );
}

/**
 * The rule between two stats.
 *
 * These used to be a `border-l` on the stat itself, but a stat is
 * `rounded-lg` — and a left border on a rounded box curves into the top and
 * bottom borders that aren't there, so each one tapered off into a hook at
 * both ends. A separate element is a straight line and stays one.
 */
function StatRule() {
  return <span aria-hidden className="h-7 w-px shrink-0 bg-border" />;
}

function Stat({
  value,
  suffix,
  label,
  className = "",
  href,
}: {
  value: string;
  suffix?: string;
  label: string;
  className?: string;
  href?: string;
}) {
  const inner = (
    <>
      <div className="text-xl font-extrabold text-ink">
        {value}
        {suffix && <span className="text-xs text-faint">{suffix}</span>}
      </div>
      <div className="font-mono text-[10px] text-faint">{label}</div>
    </>
  );

  if (href) {
    return (
      <Link
        href={href}
        className={cn(
          "min-w-0 flex-1 shrink rounded-lg px-2.5 py-1 text-right transition-colors hover:bg-hover sm:flex-none sm:px-2.5 lg:px-4",
          className,
        )}
      >
        {inner}
      </Link>
    );
  }

  return (
    <div
      className={cn("flex-1 px-2.5 text-right sm:flex-none sm:px-4", className)}
    >
      {inner}
    </div>
  );
}
