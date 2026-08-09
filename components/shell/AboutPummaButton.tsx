"use client";

import { HelpCircle } from "@/components/icons";
import { ABOUT_URL } from "@/lib/about-link";
import { cn } from "@/lib/utils";

/**
 * The "?" beside the wordmark. Looks like an about/info affordance, and is —
 * for a given value of informative.
 */
export function AboutPummaButton({ className }: { className?: string }) {
  return (
    <a
      href={ABOUT_URL}
      target="_blank"
      rel="noopener noreferrer"
      title="What is PUMMA?"
      aria-label="What is PUMMA?"
      className={cn(
        "flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-faint2 transition-colors hover:bg-hover hover:text-ink",
        className
      )}
    >
      <HelpCircle className="h-3.5 w-3.5" strokeWidth={2.2} />
    </a>
  );
}
