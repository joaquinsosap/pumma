import { Bar, Panel, SkeletonPage } from "@/components/shell/skeleton";

/** Habits: a two-column grid of tall cards, each with a year of heat cells. */
export default function HabitsLoading() {
  return (
    <SkeletonPage title="w-28">
      <Bar className="mb-3 h-2.5 w-48" />
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {Array.from({ length: 4 }, (_, i) => (
          <Panel key={i} className="flex min-h-[168px] flex-col gap-3 p-4">
            <div className="flex items-start gap-2.5">
              <Bar className="mt-0.5 h-[22px] w-[22px] shrink-0 rounded-md" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <Bar className="h-4 flex-1" />
                  <Bar className="h-6 w-16 shrink-0 rounded-md" />
                </div>
                <div className="mt-2 flex gap-1">
                  {Array.from({ length: 7 }, (_, d) => (
                    <Bar key={d} className="h-[22px] w-[22px]" />
                  ))}
                </div>
              </div>
              <Bar className="h-5 w-9 shrink-0 rounded-full" />
            </div>
            <Bar className="h-7 w-full rounded-lg" />
            <div className="flex gap-1.5">
              <Bar className="h-5 w-14 rounded-full" />
              <Bar className="h-5 w-16 rounded-full" />
            </div>
            <div className="mt-auto flex flex-col gap-1">
              {[0, 1].map((r) => (
                <div key={r} className="flex gap-[3px]">
                  {Array.from({ length: 26 }, (_, d) => (
                    <Bar key={d} className="h-3 flex-1 rounded-[3px]" />
                  ))}
                </div>
              ))}
            </div>
          </Panel>
        ))}
      </div>
    </SkeletonPage>
  );
}
