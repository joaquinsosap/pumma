import type { Project, Task } from "@/lib/schemas";
import { projectProgress } from "@/lib/metrics";
import type { Tag } from "@/lib/schemas";
import {
  WidgetHeader,
  WidgetHeaderLink,
  WidgetRowLink,
} from "@/components/home/WidgetLink";
import { TodayTasksCard } from "@/components/home/TodayTasksCard";
import { hrefWithLife, type LifeView } from "@/lib/life-area";

type Props = {
  projects: Project[];
  allTasks: Task[];
  carryover: Task[];
  tags: Tag[];
  lifeView: LifeView;
  today: string;
};

export function HomeTasksProjects({
  projects,
  allTasks,
  carryover,
  tags,
  lifeView,
  today: td,
}: Props) {
  return (
    <div className="flex flex-col gap-4 max-xl:shrink-0 xl:min-h-0">
      <TodayTasksCard
        allTasks={allTasks}
        carryover={carryover}
        tags={tags}
        lifeView={lifeView}
        today={td}
      />

      <section className="flex min-h-0 flex-col rounded-[13px] border border-border bg-surface px-[18px] py-[15px] max-xl:flex-none xl:flex-1 xl:overflow-hidden">
        <WidgetHeader accent="projects">
          <WidgetHeaderLink href={hrefWithLife("/projects", lifeView)}>
            <span className="h-2.5 w-2.5 rounded-[3px] bg-projects" />
            <h3 className="m-0 text-sm font-bold">Projects</h3>
            <span className="font-mono text-[11px] text-faint">
              {projects.length} active
            </span>
          </WidgetHeaderLink>
        </WidgetHeader>
        <div className="glow-room min-h-0 flex-1 overflow-x-hidden pb-3.5 max-xl:overflow-y-visible xl:overflow-y-auto">
          <div className="flex flex-col gap-3">
            {projects.map((p) => {
              const prog = projectProgress(p.id, allTasks);
              return (
                <WidgetRowLink
                  key={p.id}
                  href={hrefWithLife(`/projects?project=${p.id}`, lifeView)}
                >
                  <div className="mb-1.5 flex min-w-0 items-center gap-2 text-[13.5px] font-semibold">
                    <span
                      className="h-[9px] w-[9px] shrink-0 rounded-[2px]"
                      style={{ background: p.color }}
                    />
                    <span className="min-w-0 truncate">{p.title}</span>
                    <span className="ml-auto shrink-0 font-mono text-[10px] text-faint">
                      {prog.label}
                    </span>
                  </div>
                  <div className="h-[7px] overflow-hidden rounded-full bg-border2">
                    <div
                      className="h-full"
                      style={{
                        width: `${prog.progress}%`,
                        background: p.color,
                      }}
                    />
                  </div>
                </WidgetRowLink>
              );
            })}
          </div>
        </div>
      </section>
    </div>
  );
}
