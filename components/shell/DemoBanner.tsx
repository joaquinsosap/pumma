import { LeaveDemoButton } from "@/components/shell/LeaveDemoButton";
import { cn } from "@/lib/utils";

/**
 * Demo marker: a compact pill that rides along the brand row (phone header /
 * sidebar) so demo sessions render the exact same layout as real accounts —
 * no banner pushing the UI down.
 */
export function DemoBanner({
  expiresAt,
  className,
}: {
  expiresAt: string | null;
  className?: string;
}) {
  const hoursLeft = expiresAt
    ? Math.max(1, Math.round((Date.parse(expiresAt) - Date.now()) / 3_600_000))
    : null;
  return (
    <div
      className={cn(
        "flex min-w-0 shrink-0 items-center gap-1.5 rounded-full border border-primary/25 bg-primary/[0.08] py-1 pl-2.5 pr-1",
        className,
      )}
      title={
        hoursLeft
          ? `Demo account — sample data, resets in ~${hoursLeft}h`
          : "Demo account — sample data, temporary"
      }
    >
      <span className="font-mono text-[9px] font-bold uppercase tracking-widest text-primary">
        Demo
      </span>
      {hoursLeft !== null && (
        <span className="font-mono text-[9px] tabular-nums text-muted">
          ~{hoursLeft}h
        </span>
      )}
      <LeaveDemoButton className="rounded-full bg-primary px-2 py-0.5 text-[10px] font-bold text-white no-underline hover:text-white">
        Keep →
      </LeaveDemoButton>
    </div>
  );
}
