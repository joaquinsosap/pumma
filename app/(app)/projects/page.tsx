import { loadPageData } from "@/lib/page-data";
import { ProjectsView } from "@/components/projects/ProjectsView";
import { requireUserId } from "@/lib/auth/session";
import { getJiraSecretsEnc } from "@/lib/db/settings";

type Props = { searchParams: Promise<{ tag?: string; life?: string }> };

export default async function ProjectsPage({ searchParams }: Props) {
  const data = await loadPageData(searchParams);
  // Only whether a connection is saved. The sealed values themselves stay on the server.
  const jira = await getJiraSecretsEnc(await requireUserId());
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
      sortReversed={data.settings?.sortReversed ?? []}
      jiraConnected={Boolean(jira.baseUrlEnc && jira.tokenEnc)}
    />
  );
}
