import { Bar, Panel, SkeletonPage } from "@/components/shell/skeleton";

/** Projects: the rail of project cards above the board. */
export default function ProjectsLoading() {
  return (
    <SkeletonPage title="w-28">
      <div className="flex min-h-0 flex-1 flex-col gap-4">
        <div className="grid shrink-0 grid-cols-2 gap-2.5 sm:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 4 }, (_, i) => (
            <Panel key={i} className="p-3.5">
              <div className="mb-2.5 flex items-center gap-2">
                <Bar className="h-2.5 w-2.5 shrink-0 rounded-full" />
                <Bar className="h-3.5 min-w-0 flex-1" />
              </div>
              <Bar className="mb-2 h-2.5 w-16" />
              <Bar className="h-1.5 w-full rounded-full" />
            </Panel>
          ))}
        </div>
        <div className="grid min-h-0 flex-1 gap-3 md:grid-cols-3">
          {["w-16", "w-20", "w-12"].map((w, col) => (
            <Panel key={col} className="flex min-h-[220px] flex-col gap-2 p-3">
              <div className="mb-1 flex items-center justify-between">
                <Bar className={`h-3 ${w}`} />
                <Bar className="h-3 w-5" />
              </div>
              {Array.from({ length: 3 - col }, (_, i) => (
                <Bar key={i} className="h-14 rounded-lg" />
              ))}
            </Panel>
          ))}
        </div>
      </div>
    </SkeletonPage>
  );
}
