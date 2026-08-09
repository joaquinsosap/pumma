import { Bar, Panel, SkeletonPage } from "@/components/shell/skeleton";

/**
 * Life calendar: the counters, the legend, then one square per week of a life.
 *
 * The grid is the page — anything that doesn't put a dense block of small
 * squares here is describing a different page.
 */
export default function LifeLoading() {
  return (
    <SkeletonPage title="w-40">
      <Panel className="mb-3 shrink-0 px-4 py-3">
        <div className="flex flex-wrap gap-x-10 gap-y-3">
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i}>
              <Bar className="mb-2 h-2 w-14" />
              <Bar className="h-5 w-24" />
            </div>
          ))}
        </div>
        <Bar className="mt-3 h-1.5 w-full rounded-full" />
      </Panel>

      <div className="mb-3 flex shrink-0 flex-wrap items-center gap-2.5">
        {[10, 12, 14, 10, 9, 9, 8, 11].map((w, i) => (
          <div key={i} className="flex items-center gap-1.5">
            <Bar className="h-2.5 w-2.5 rounded-[3px]" />
            <Bar className="h-2" width={`${w * 4}px`} />
          </div>
        ))}
        <Bar className="ml-auto h-5 w-16 rounded-full" />
      </div>

      <Panel className="min-h-0 flex-1 overflow-hidden p-4">
        <div className="mb-2 flex items-center justify-between">
          <Bar className="h-2 w-10" />
          <Bar className="h-2 w-28" />
          <Bar className="h-2 w-12" />
        </div>
        <div className="flex flex-col gap-[2px]">
          {Array.from({ length: 24 }, (_, row) => (
            <div key={row} className="flex items-center gap-[2px]">
              <Bar className="mr-1.5 h-2 w-4 shrink-0" />
              {Array.from({ length: 52 }, (_, week) => (
                <Bar
                  key={week}
                  className="aspect-square flex-1 rounded-[2px]"
                />
              ))}
              <Bar className="ml-1.5 h-2 w-6 shrink-0" />
            </div>
          ))}
        </div>
      </Panel>
    </SkeletonPage>
  );
}
