import { Bar, Panel, SkeletonPage } from "@/components/shell/skeleton";

/**
 * Assistant: the prompt, then the plan it draws.
 *
 * This is only the wait for the route itself. Once the page is up it has its
 * own thinking state for the wait that actually takes a while.
 */
export default function AssistantLoading() {
  return (
    <SkeletonPage title="w-28">
      <div className="flex min-h-0 flex-1 flex-col items-center gap-4 pt-8">
        <Bar className="h-4 w-64 max-w-full" />
        <Bar className="h-3 w-80 max-w-full" />
        <div className="mt-4 flex w-full max-w-2xl flex-col gap-3">
          {[0, 1, 2].map((i) => (
            <Panel key={i} className="flex items-center gap-3 p-3.5">
              <Bar className="h-7 w-7 shrink-0 rounded-lg" />
              <div className="min-w-0 flex-1">
                <Bar className="mb-2 h-3" width={`${70 - i * 10}%`} />
                <Bar className="h-2.5 w-24" />
              </div>
            </Panel>
          ))}
        </div>
      </div>
    </SkeletonPage>
  );
}
