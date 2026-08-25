"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useIsDesktop } from "@/lib/use-media-query";
import { cn } from "@/lib/utils";

/**
 * Draggable phone bottom sheet (no deps) with natural gestures: the handle
 * follows your finger continuously (grow or shrink) and settles on the
 * nearest snap — peek (~55%) or full screen — dismissing on a deep pull.
 * Swiping up on the content grows the sheet before the content scrolls;
 * pulling down at the top collapses it. Focusing any input expands it for
 * the keyboard. Backdrop tap closes; body scroll locked while open.
 */
export function BottomSheet({
  open,
  onClose,
  children,
  initialSnap = "peek",
}: {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  initialSnap?: "peek" | "full";
}) {
  // The breakpoint lives here rather than at the call sites. It used to be a
  // `lg:hidden` wrapper around each sheet, which worked right up until the
  // sheet started portalling to <body> and left that wrapper behind: five
  // call sites at once began opening an empty sheet over the desktop layout.
  // A wrapper cannot gate something that renders somewhere else, so the phone
  // sheet decides for itself that it is a phone sheet.
  const isDesktop = useIsDesktop();
  const [snap, setSnap] = useState<"peek" | "full">(initialSnap);
  // While the handle is being dragged, the sheet height tracks the finger.
  const [dragHeight, setDragHeight] = useState<number | null>(null);
  const drag = useRef<{
    startY: number;
    startHeight: number;
    last: number;
  } | null>(null);
  const sheetRef = useRef<HTMLDivElement>(null);

  const peekPx = () => window.innerHeight * 0.55;
  const fullPx = () => window.innerHeight - 12;

  useEffect(() => {
    if (open) setSnap(initialSnap);
  }, [open, initialSnap]);

  useEffect(() => {
    if (!open || isDesktop) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open, isDesktop]);

  // Snap to full whenever an input inside the sheet gains focus (keyboard).
  const onFocusCapture = () => setSnap("full");

  // Natural content gestures: swipe up at peek → grow; pull down at top of a
  // fully-grown sheet → collapse (then dismiss from peek).
  const contentRef = useRef<HTMLDivElement>(null);
  const touch = useRef<{ y: number; atTop: boolean } | null>(null);
  const onContentTouchStart = (e: React.TouchEvent) => {
    touch.current = {
      y: e.touches[0].clientY,
      atTop: (contentRef.current?.scrollTop ?? 0) <= 0,
    };
  };
  const onContentTouchMove = (e: React.TouchEvent) => {
    if (!touch.current) return;
    const dy = e.touches[0].clientY - touch.current.y;
    if (snap === "peek" && dy < -14) {
      setSnap("full");
      touch.current = null;
    } else if (snap === "full" && touch.current.atTop && dy > 90) {
      setSnap("peek");
      contentRef.current?.scrollTo({ top: 0 });
      touch.current = null;
    } else if (snap === "peek" && touch.current.atTop && dy > 110) {
      onClose();
      touch.current = null;
    }
  };
  const onContentTouchEnd = () => {
    touch.current = null;
  };

  // Handle drag: height follows the finger in both directions.
  const onPointerDown = (e: React.PointerEvent) => {
    const startHeight =
      sheetRef.current?.getBoundingClientRect().height ??
      (snap === "full" ? fullPx() : peekPx());
    drag.current = { startY: e.clientY, startHeight, last: startHeight };
    try {
      (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    } catch {
      // synthetic/secondary pointers can't be captured — dragging still works
    }
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag.current) return;
    const next = Math.min(
      fullPx(),
      Math.max(
        90,
        drag.current.startHeight - (e.clientY - drag.current.startY),
      ),
    );
    drag.current.last = next;
    setDragHeight(next);
  };
  const onPointerUp = () => {
    if (!drag.current) return;
    const h = drag.current.last;
    drag.current = null;
    setDragHeight(null);
    // Deep pull below peek → dismiss; otherwise settle on the nearest snap.
    if (h < peekPx() * 0.6) {
      onClose();
      return;
    }
    setSnap(h > (peekPx() + fullPx()) / 2 ? "full" : "peek");
  };

  if (!open || isDesktop) return null;

  // Portalled to <body>, not rendered where it is used.
  //
  // A full-viewport overlay has no business living inside the page's content
  // tree. It was mounted next to the list it belongs to, several levels deep
  // inside the app shell, and `position: fixed` only escapes an ancestor's
  // clip while no ancestor establishes a containing block for it. That is a
  // property of every element above it, in every engine, and it is not
  // something a sheet can check.
  //
  // The shell's frame is `overflow: clip`, and WebKit applies that clip to
  // fixed descendants where Blink does not — so the sheet covered the screen
  // on a desktop browser pretending to be a phone, and was cut to the size of
  // the panel behind it on an actual one. Portalling settles it everywhere at
  // once and stops the sheet depending on layout decisions made three
  // components away.
  return createPortal(
    <div className="fixed inset-0 z-[60]">
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="animate-pumma-fade absolute inset-0 bg-black/40"
      />
      <div
        ref={sheetRef}
        onFocusCapture={onFocusCapture}
        className={cn(
          "pumma-floating animate-pumma-sheet-up absolute inset-x-0 bottom-0 flex flex-col overflow-hidden rounded-t-2xl border border-b-0 border-border bg-background shadow-[0_-4px_24px_rgba(0,0,0,0.18)]",
          dragHeight === null && "transition-[height] duration-200",
        )}
        style={{
          height:
            dragHeight !== null
              ? `${dragHeight}px`
              : snap === "full"
                ? "calc(100dvh - max(env(safe-area-inset-top), 12px))"
                : "55dvh",
          paddingBottom: "env(safe-area-inset-bottom)",
        }}
      >
        {/* No strip — a floating pill over a transparent grab zone.
            A strip with its own colour is the thing that came apart: it is
            fixed while the panel head below it scrolls, so any tint it wore
            was left stranded the moment you slid the sheet. Deleting the band
            deletes the problem — there is nothing left to strand.
            What stays is the GESTURE: this zone is full width and invisible,
            so the drag target is still a whole row rather than a 40px pill,
            which is the one thing the pill-only version gives up.
            The pill keeps the accent; the surface behind it does not. */}
        <div
          className="absolute inset-x-0 top-0 z-20 flex h-9 shrink-0 cursor-grab touch-none justify-center pt-2.5 active:cursor-grabbing"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          <div className="h-1.5 w-10 rounded-full bg-[color-mix(in_oklab,var(--primary)_45%,transparent)] shadow-[0_1px_4px_rgba(10,20,35,0.18)]" />
        </div>
        <div
          ref={contentRef}
          onTouchStart={onContentTouchStart}
          onTouchMove={onContentTouchMove}
          onTouchEnd={onContentTouchEnd}
          className={cn(
            // pt-9 clears the pill at rest AND gives the top of the sheet the
            // breathing room it never had when a padded strip was doing the
            // spacing for it.
            "min-h-0 flex-1 overscroll-contain pt-9",
            // At peek the sheet itself is the gesture surface — content only
            // scrolls once the sheet is fully grown.
            snap === "full" ? "overflow-y-auto" : "overflow-hidden",
          )}
        >
          {children}
        </div>
      </div>
    </div>,
    document.body,
  );
}
