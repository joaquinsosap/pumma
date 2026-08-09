"use client";

import { useCallback, useEffect, useState, type RefObject } from "react";
import { ChevronDown, ChevronRight } from "@/components/icons";
import { cn } from "@/lib/utils";

type Direction = "right" | "down";

/**
 * Floating affordance that tells the user "there's more — scroll this way".
 * Renders a small bordered box with a nudging arrow, pinned to the far edge of
 * a scrollable container; hides itself once the container is scrolled to the
 * end (or doesn't overflow at all). Clicking it advances the scroll.
 *
 * Usage: the scroll container's PARENT must be `position: relative`; pass a ref
 * to the scrollable element itself.
 *
 *   <div className="relative">
 *     <div ref={ref} className="overflow-x-auto">…</div>
 *     <ScrollHint targetRef={ref} direction="right" />
 *   </div>
 */
export function ScrollHint({
  targetRef,
  direction = "right",
  className,
}: {
  targetRef: RefObject<HTMLElement | null>;
  direction?: Direction;
  className?: string;
}) {
  const [visible, setVisible] = useState(false);

  const recompute = useCallback(() => {
    const el = targetRef.current;
    if (!el) return;
    const remaining =
      direction === "right"
        ? el.scrollWidth - el.clientWidth - el.scrollLeft
        : el.scrollHeight - el.clientHeight - el.scrollTop;
    setVisible(remaining > 8);
  }, [targetRef, direction]);

  // No dep array on purpose: content changes arrive via re-renders, and the
  // check is a couple of layout reads on a small container.
  useEffect(recompute);

  useEffect(() => {
    const el = targetRef.current;
    if (!el) return;
    el.addEventListener("scroll", recompute, { passive: true });
    const ro = new ResizeObserver(recompute);
    ro.observe(el);
    window.addEventListener("resize", recompute);
    return () => {
      el.removeEventListener("scroll", recompute);
      ro.disconnect();
      window.removeEventListener("resize", recompute);
    };
  }, [targetRef, recompute]);

  if (!visible) return null;

  const advance = () => {
    const el = targetRef.current;
    if (!el) return;
    if (direction === "right") {
      el.scrollBy({ left: el.clientWidth * 0.7, behavior: "smooth" });
    } else {
      el.scrollBy({ top: el.clientHeight * 0.7, behavior: "smooth" });
    }
  };

  return (
    <button
      type="button"
      onClick={advance}
      aria-label={direction === "right" ? "Scroll right for more" : "Scroll down for more"}
      className={cn(
        "absolute z-10 flex h-7 w-7 cursor-pointer items-center justify-center rounded-lg",
        "border border-border bg-surface/95 text-muted shadow-[2px_2px_0_var(--shadow)] backdrop-blur-sm",
        "transition-colors hover:border-faint hover:text-ink",
        direction === "right"
          ? "right-1 top-1/2 -translate-y-1/2"
          : "bottom-2 left-1/2 -translate-x-1/2",
        className
      )}
    >
      {direction === "right" ? (
        <ChevronRight className="h-4 w-4 scroll-hint-arrow-x" />
      ) : (
        <ChevronDown className="h-4 w-4 scroll-hint-arrow-y" />
      )}
    </button>
  );
}
