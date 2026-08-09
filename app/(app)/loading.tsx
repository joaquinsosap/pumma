import {
  Bar,
  Panel,
  PanelHead,
  Row,
  SkeletonPage,
} from "@/components/shell/skeleton";

/**
 * Home: agenda | tasks over projects | habits over goals over the streak card.
 *
 * This is also the fallback any route without its own `loading.tsx` gets, but
 * every route the sidebar can reach has one — see the files beside this.
 */
export default function HomeLoading() {
  return (
    <SkeletonPage greeting>
      <div className="flex min-h-0 flex-1 flex-col gap-4 md:grid md:grid-cols-2 md:[&>*:nth-child(3)]:col-span-2 xl:grid-cols-[304px_1fr_340px] xl:[&>*:nth-child(3)]:col-span-1">
        <Panel className="min-h-[280px] overflow-hidden">
          <PanelHead />
          <div className="grid grid-cols-7 gap-1 px-4 py-3">
            {Array.from({ length: 7 }, (_, i) => (
              <Bar key={i} className="h-9" />
            ))}
          </div>
          <div className="space-y-3 px-4 pb-4">
            {[0, 1, 2].map((i) => (
              <div key={i} className="flex gap-3">
                <Bar className="h-3 w-10 shrink-0" />
                <Bar className="h-9 flex-1" />
              </div>
            ))}
          </div>
        </Panel>

        <div className="flex min-h-0 flex-col gap-4">
          <Panel className="flex-1 overflow-hidden">
            <PanelHead wide />
            {[0, 1, 2, 3, 4].map((i) => (
              <Row key={i} width={`${72 - i * 7}%`} />
            ))}
          </Panel>
          <Panel className="overflow-hidden">
            <PanelHead />
            {[0, 1, 2].map((i) => (
              <div key={i} className="px-4 py-2.5">
                <Bar className="mb-2 h-3" width={`${60 - i * 10}%`} />
                <Bar className="h-1.5 w-full rounded-full" />
              </div>
            ))}
          </Panel>
        </div>

        <div className="flex min-h-0 flex-col gap-4">
          <Panel className="overflow-hidden">
            <PanelHead />
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="flex items-center gap-2.5 px-4 py-2">
                <Bar className="h-[18px] w-[18px] shrink-0 rounded-[5px]" />
                <Bar className="h-3 flex-1" />
                <div className="flex shrink-0 gap-[3px]">
                  {Array.from({ length: 7 }, (_, d) => (
                    <Bar key={d} className="h-2.5 w-2.5 rounded-[3px]" />
                  ))}
                </div>
              </div>
            ))}
          </Panel>
          <Panel className="overflow-hidden">
            <PanelHead />
            {[0, 1, 2].map((i) => (
              <div key={i} className="px-4 py-2.5">
                <Bar className="mb-2 h-3" width={`${65 - i * 8}%`} />
                <Bar className="h-1.5 w-full rounded-full" />
              </div>
            ))}
          </Panel>
          <Bar className="h-[74px] rounded-[13px]" />
        </div>
      </div>
    </SkeletonPage>
  );
}
