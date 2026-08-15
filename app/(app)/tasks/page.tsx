import { loadPageData } from "@/lib/page-data";
import { TasksView } from "@/components/tasks/TasksView";

type Props = { searchParams: Promise<{ tag?: string; life?: string }> };

export default async function TasksPage({ searchParams }: Props) {
  const data = await loadPageData(searchParams);
  return (
    <TasksView
      tasks={data.tasks}
      carryover={data.carryover}
      tags={data.tags}
      projects={data.projects}
      stats={data.stats}
      birthDate={data.birthDate}
      lifeSpanYears={data.lifeSpanYears}
      taskSort={data.settings?.taskSort ?? "priority"}
    />
  );
}
