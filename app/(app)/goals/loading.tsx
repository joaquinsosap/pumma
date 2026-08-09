import { Bar, Panel, SkeletonPage } from "@/components/shell/skeleton";

/** Goals: one panel, cards on the left and the detail rail on the right. */
export default function GoalsLoading() {
  return (
    <SkeletonPage title="w-24">
      <Panel className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden lg:grid-cols-[minmax(0,1fr)_minmax(280px,320px)]">
        <div className="min-h-0 p-3 lg:border-r lg:border-border2 lg:p-4">
          {["w-20", "w-16"].map((w, col) => (
            <div key={col} className={col ? "mt-5" : undefined}>
              <div className="mb-2.5 flex items-center gap-2">
                <Bar className="h-2.5 w-2.5 rounded-full" />
                <Bar className={`h-3 ${w}`} />
              </div>
              <div className="grid gap-2.5 sm:grid-cols-2">
                {Array.from({ length: col ? 2 : 3 }, (_, i) => (
                  <Panel key={i} className="p-3.5">
                    <Bar className="mb-2.5 h-3.5" width={`${80 - i * 12}%`} />
                    <Bar className="mb-2 h-1.5 w-full rounded-full" />
                    <div className="flex gap-1.5">
                      <Bar className="h-4 w-12 rounded-full" />
                      <Bar className="h-4 w-10 rounded-full" />
                    </div>
                  </Panel>
                ))}
              </div>
            </div>
          ))}
        </div>
        <div className="hidden min-h-0 flex-col gap-4 p-4 lg:flex">
          <Bar className="h-2.5 w-10" />
          <Bar className="h-9 w-full rounded-lg" />
          <Bar className="h-2.5 w-12" />
          <div className="flex gap-1.5">
            <Bar className="h-5 w-14 rounded-full" />
            <Bar className="h-5 w-12 rounded-full" />
          </div>
          <Bar className="h-2.5 w-16" />
          <Bar className="h-24 w-full rounded-lg" />
        </div>
      </Panel>
    </SkeletonPage>
  );
}
