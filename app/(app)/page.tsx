import { loadPageData } from "@/lib/page-data";
import { Topbar } from "@/components/shell/Topbar";
import { AgendaPanel } from "@/components/home/AgendaPanel";
import { HomeTasksProjects } from "@/components/home/HomeTasksProjects";
import { HomeHabitsGoals } from "@/components/home/HomeHabitsGoals";
import { displayName } from "@/lib/user-display";

type Props = {
  searchParams: Promise<{ life?: string; day?: string }>;
};

export default async function HomePage({ searchParams }: Props) {
  const data = await loadPageData(searchParams);
  const { lifeView } = data;
  const weekStart = data.settings?.weekStart ?? "mon";

  return (
    <>
      <Topbar
        title=""
        showGreeting
        userName={displayName(data.user)}
        dayPct={data.stats.dayPct}
        habitsLabel={data.stats.habitsLabel}
        topStreak={data.stats.topStreak}
        birthDate={data.birthDate}
        lifeSpanYears={data.lifeSpanYears}
      />
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto pb-5 max-lg:pb-28 animate-pumma-view md:grid md:grid-cols-2 md:[&>*:nth-child(3)]:col-span-2 xl:grid-cols-[304px_1fr_340px] xl:overflow-hidden xl:[&>*:nth-child(3)]:col-span-1">
        <AgendaPanel
          agenda={data.agenda}
          tasks={data.allTasks}
          lifeView={lifeView}
          weekStart={weekStart}
        />
        <HomeTasksProjects
          projects={data.projects}
          allTasks={data.allTasks}
          carryover={data.carryover}
          tags={data.tags}
          lifeView={lifeView}
          today={data.today}
        />
        <HomeHabitsGoals
          habits={data.habits}
          habitEntries={data.habitEntries}
          goals={data.goals}
          topStreak={data.stats.topStreak}
          lifeView={lifeView}
          weekStart={weekStart}
        />
      </div>
    </>
  );
}
