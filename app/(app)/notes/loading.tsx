import { Bar, Panel, SkeletonPage } from "@/components/shell/skeleton";

/** Notes: the note list on the left, the editor filling the rest. */
export default function NotesLoading() {
  return (
    <SkeletonPage title="w-20">
      <div className="flex min-h-0 flex-1 flex-col gap-3 md:flex-row md:gap-[18px]">
        <div className="flex min-h-0 shrink-0 flex-col gap-2 md:w-[260px] lg:w-[300px]">
          <Bar className="h-9 w-full rounded-lg" />
          {Array.from({ length: 5 }, (_, i) => (
            <Panel key={i} className="p-3">
              <Bar className="mb-2 h-3" width={`${78 - i * 8}%`} />
              <Bar className="h-2.5 w-full" />
            </Panel>
          ))}
        </div>
        <Panel className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <div className="flex items-center gap-2.5 border-b border-border2 px-5 py-4">
            <Bar className="h-5 w-56 max-w-full" />
            <Bar className="ml-auto h-6 w-6 shrink-0 rounded-md" />
            <Bar className="h-6 w-20 shrink-0 rounded-md" />
          </div>
          <div className="flex flex-col gap-2.5 px-5 py-4">
            {["100%", "96%", "88%", "100%", "72%", "94%", "40%"].map((w, i) => (
              <Bar key={i} className="h-3" width={w} />
            ))}
          </div>
        </Panel>
      </div>
    </SkeletonPage>
  );
}
