import { Bar, Panel, SkeletonPage } from "@/components/shell/skeleton";

/**
 * Settings: full-width sections at the top and bottom, a pair of narrower
 * ones in the middle. That rhythm is the page's shape — a uniform two-column
 * grid would land in the wrong place on both ends.
 */
const SECTIONS: { full: boolean; fields: number }[] = [
  { full: true, fields: 2 },
  { full: true, fields: 3 },
  { full: true, fields: 1 },
  { full: false, fields: 3 },
  { full: false, fields: 2 },
  { full: false, fields: 2 },
  { full: false, fields: 2 },
];

export default function SettingsLoading() {
  return (
    <SkeletonPage title="w-24">
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {SECTIONS.map((s, i) => (
          <Panel key={i} className={s.full ? "p-4 lg:col-span-2" : "p-4"}>
            <Bar className="mb-4 h-3.5 w-28" />
            <div
              className={
                s.full ? "grid gap-4 sm:grid-cols-2" : "flex flex-col gap-4"
              }
            >
              {Array.from({ length: s.fields }, (_, f) => (
                <div key={f}>
                  <Bar className="mb-2 h-2.5 w-20" />
                  <Bar className="h-9 w-full rounded-lg" />
                </div>
              ))}
            </div>
          </Panel>
        ))}
      </div>
    </SkeletonPage>
  );
}
