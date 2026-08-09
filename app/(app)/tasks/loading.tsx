import { Bar, Panel, Row, SkeletonPage } from "@/components/shell/skeleton";

/** Tasks: the filter bar, then groups of rows. */
export default function TasksLoading() {
  return (
    <SkeletonPage title="w-24">
      <div className="flex min-h-0 flex-1 flex-col">
        <Panel className="mb-3 flex shrink-0 flex-wrap items-center gap-3 px-4 py-3 lg:mb-5">
          <Bar className="h-7 w-[168px] rounded-lg" />
          <span className="hidden h-5 w-px bg-border sm:block" />
          <Bar className="h-7 w-[152px] rounded-lg" />
          <span className="hidden h-5 w-px bg-border sm:block" />
          <Bar className="h-7 w-[120px] rounded-lg" />
          <Bar className="ml-auto h-7 w-20 rounded-lg" />
        </Panel>
        <div className="flex min-h-0 flex-1 flex-col gap-4">
          {[5, 3].map((rows, g) => (
            <div key={g}>
              <Bar className="mb-2 ml-1 h-2.5 w-28" />
              <Panel className="overflow-hidden">
                {Array.from({ length: rows }, (_, i) => (
                  <Row key={i} width={`${76 - i * 9}%`} />
                ))}
              </Panel>
            </div>
          ))}
        </div>
      </div>
    </SkeletonPage>
  );
}
