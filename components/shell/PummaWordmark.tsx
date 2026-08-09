import { ABOUT_URL } from "@/lib/about-link";
import { cn } from "@/lib/utils";

/**
 * The "P.U.M.M.A" wordmark. Hovering explains what the letters stand for;
 * clicking explains nothing at all, at length, in 4:3 — the same destination
 * the "?" beside it promises, because half a joke is worse than none.
 *
 * Pure CSS (group-hover) so it still works in a server component.
 */
export function PummaWordmark({ className }: { className?: string }) {
  return (
    <span className={cn("group/brand relative inline-block", className)}>
      <a
        href={ABOUT_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="cursor-pointer text-inherit no-underline"
      >
        P.U.M.M.A
      </a>
      <span
        aria-hidden="true"
        className="pumma-floating pointer-events-none absolute left-0 top-full z-50 mt-2 w-[248px] rounded-[10px] border border-border bg-surface p-3 text-left opacity-0 shadow-[2px_2px_0_var(--shadow)] transition-opacity duration-150 group-hover/brand:opacity-100"
      >
        <span className="block text-[12px] font-bold leading-tight text-ink">
          Procrastination Ultimate Megasor Monster Annihilator
        </span>
        <span className="mt-1.5 block text-[11px] font-normal leading-snug text-muted">
          cool isn&rsquo;t it?
        </span>
        {/* Straight-faced on purpose: the flatter this reads, the further the
            click has to fall. */}
        <span className="mt-2 block text-[10.5px] font-normal leading-snug text-faint">
          Click for more information.
        </span>
      </span>
    </span>
  );
}
