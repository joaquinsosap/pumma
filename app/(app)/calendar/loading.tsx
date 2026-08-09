import { Bar, Panel, SkeletonPage } from "@/components/shell/skeleton";

/** Calendar: the month grid, with the selected day's panel beside it. */
export default function CalendarLoading() {
  return (
    <SkeletonPage title="w-28">
      <div className="flex min-h-0 flex-1 flex-col gap-3 lg:flex-row lg:gap-[18px]">
        <Panel className="flex min-w-0 flex-1 flex-col overflow-hidden">
          <div className="flex items-center gap-3 px-5 py-4">
            <Bar className="h-5 w-40" />
            <Bar className="ml-auto h-7 w-16 rounded-lg" />
          </div>
          <div className="grid grid-cols-7 gap-px border-t border-border2 px-5 pt-3">
            {Array.from({ length: 7 }, (_, i) => (
              <Bar key={i} className="mx-auto mb-2 h-2.5 w-6" />
            ))}
          </div>
          <div className="grid flex-1 grid-cols-7 gap-1.5 px-5 pb-5">
            {Array.from({ length: 35 }, (_, i) => (
              <Bar key={i} className="min-h-[52px] rounded-lg" />
            ))}
          </div>
        </Panel>
        <Panel className="flex shrink-0 flex-col gap-3 p-4 lg:w-[320px]">
          <Bar className="h-4 w-32" />
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="flex gap-2.5">
              <Bar className="h-3 w-9 shrink-0" />
              <Bar className="h-10 flex-1 rounded-lg" />
            </div>
          ))}
        </Panel>
      </div>
    </SkeletonPage>
  );
}
