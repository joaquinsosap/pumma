import { cn } from "@/lib/utils";

/**
 * The pieces each route's `loading.tsx` is drawn from.
 *
 * There used to be one skeleton for the whole app — four grey rectangles in a
 * two-by-two grid, shown whether you were opening the calendar, the life grid
 * or a note. It filled the time but told you nothing, and every arrival was a
 * small jump from a shape that was never right to the shape that was.
 *
 * We know what each page looks like before its data arrives, so each one gets
 * a skeleton of its own layout: the same columns, the same panel widths, the
 * same rows. Then the wait reads as the page drawing itself rather than as
 * something unrelated being swapped out.
 *
 * These are shapes only. Nothing here should carry real numbers or labels —
 * a skeleton that guesses at content is a skeleton that can be wrong.
 */

/** A grey block. Everything below is made of these. */
export function Bar({
  className,
  width,
}: {
  className?: string;
  width?: string;
}) {
  return (
    <div
      className={cn("rounded-md bg-skeleton", className)}
      style={{ width }}
    />
  );
}

/** A bordered surface, the shell most of the app's content sits in. */
export function Panel({
  className,
  children,
}: {
  className?: string;
  children?: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "rounded-[13px] border border-border bg-surface",
        className,
      )}
    >
      {children}
    </div>
  );
}

/** A panel's coloured title bar, with room for a control or two on the right. */
export function PanelHead({ wide }: { wide?: boolean }) {
  return (
    <div className="flex items-center justify-between border-b border-border2 bg-surface2/50 px-4 py-2.5">
      <Bar className={cn("h-3.5", wide ? "w-40" : "w-24")} />
      <Bar className="h-3.5 w-12" />
    </div>
  );
}

/** One line of a list: a mark, a label, and something aligned right. */
export function Row({
  width = "70%",
  mark = true,
}: {
  width?: string;
  mark?: boolean;
}) {
  return (
    <div className="flex items-center gap-2.5 px-4 py-2.5">
      {mark && <Bar className="h-[18px] w-[18px] shrink-0 rounded-[5px]" />}
      <Bar className="h-3 min-w-0" width={width} />
      <Bar className="ml-auto h-2.5 w-10 shrink-0" />
    </div>
  );
}

/**
 * The page frame: the top bar every route has, then the route's own body.
 *
 * `title` is the width of the page's heading — "Habits" and "Life calendar"
 * are not the same size, and matching it is most of what stops the heading
 * from jumping when the real page lands.
 */
export function SkeletonPage({
  title = "w-32",
  greeting = false,
  children,
}: {
  title?: string;
  greeting?: boolean;
  children: React.ReactNode;
}) {
  return (
    // Two layers on purpose: the outer one holds the skeleton back for a beat
    // (see .skeleton-hold), the inner one does the pulsing. One element cannot
    // run both animations without one overwriting the other.
    <div className="skeleton-hold flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-0 flex-1 animate-pulse flex-col">
        <div className="mb-3 flex shrink-0 flex-col gap-2 sm:mb-4 sm:flex-row sm:items-end sm:justify-between sm:gap-0">
          <div className="min-w-0">
            <Bar className="mb-2 h-2.5 w-64 max-w-full sm:w-80" />
            <div className="flex h-8 items-center sm:h-9">
              <Bar className={cn("h-6 sm:h-7", greeting ? "w-56" : title)} />
            </div>
          </div>
          <div className="flex items-center gap-1">
            {[0, 1, 2].map((i) => (
              <div key={i} className="flex items-center gap-1">
                {i > 0 && <span className="h-7 w-px bg-border" />}
                <div className="px-2.5 py-1 text-right sm:px-4">
                  <Bar className="mb-1.5 ml-auto h-5 w-12" />
                  <Bar className="ml-auto h-2 w-14" />
                </div>
              </div>
            ))}
          </div>
        </div>
        {children}
      </div>
    </div>
  );
}
