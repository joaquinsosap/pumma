import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Shared column layout: checkbox · name · week strip · streak */
export const habitWeekRowClass =
  "grid grid-cols-[19px_minmax(0,1fr)_auto_26px] items-center gap-x-2.5";

export const habitWeekCellClass = "h-3 w-3 shrink-0";

export function HabitWeekStrip({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={cn("flex gap-[3px]", className)}>{children}</div>;
}
