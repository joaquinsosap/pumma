import { loadPageData } from "@/lib/page-data";
import { ProjectsView } from "@/components/projects/ProjectsView";

type Props = { searchParams: Promise<{ tag?: string; life?: string }> };

export default async function ProjectsPage({ searchParams }: Props) {
  const data = await loadPageData(searchParams);
  return (
    <ProjectsView
      projects={data.projects}
      tasks={data.tasks}
      tags={data.tags}
      goals={data.goals}
      stats={data.stats}
      birthDate={data.birthDate}
      lifeSpanYears={data.lifeSpanYears}
      projectSort={data.settings?.projectSort ?? "created"}
      projectTaskSort={data.settings?.projectTaskSort ?? "priority"}
      projectsRailSortVisible={
        data.settings?.projectsRailSortVisible ?? false
      }
    />
  );
}
