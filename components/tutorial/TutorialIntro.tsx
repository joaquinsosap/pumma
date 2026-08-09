"use client";

import { useState } from "react";
import { Play, X } from "@/components/icons";
import { cn } from "@/lib/utils";
import { PummaMark } from "@/components/shell/PummaMark";

/**
 * The card that opens the tour, and the joke it tells.
 *
 * The two buttons live in fixed grid cells and SLIDE past each other, rather
 * than being re-ordered in the DOM. Re-ordering swapped them instantly and in
 * silence: same two buttons, same two places, and the eye reads it as nothing
 * having happened — you just think you missed. Watching them physically
 * change lanes is the whole gag, so it has to be a move you can see.
 *
 * The bit is over in two clicks. The first press swaps them; the second
 * accepts the skip, says so, and starts the tour anyway. A gag with no exit
 * stops being a gag somewhere around the third attempt.
 */
export function TutorialIntro({ onStart }: { onStart: () => void }) {
  // 0 — untouched · 1 — buttons have swapped · 2 — the fake-out is playing
  const [stage, setStage] = useState<0 | 1 | 2>(0);
  const swapped = stage >= 1;

  const onSkip = () => {
    if (stage === 0) {
      setStage(1);
      return;
    }
    if (stage === 1) {
      setStage(2);
      window.setTimeout(onStart, 1500);
    }
  };

  // Each button sits in its own half and is pushed a full lane sideways when
  // swapped: one goes right, the other left, and they cross in view.
  const lane = (isSkip: boolean) =>
    ({
      transform: swapped
        ? `translateX(calc(${isSkip ? "100% + 10px" : "-100% - 10px"}))`
        : "translateX(0)",
    }) as React.CSSProperties;

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/55 px-4 backdrop-blur-sm">
      <div className="w-full max-w-[420px] rounded-[20px] border-2 border-ink bg-surface p-6 shadow-[0_1px_2px_var(--shadow),0_24px_60px_-12px_var(--shadow)]">
        <PummaMark className="h-11 w-11 shrink-0 rounded-[12px]" />
        <h2 className="m-0 mt-4 text-[22px] font-extrabold leading-tight tracking-tight text-ink">
          Sixty seconds, then it&apos;s yours.
        </h2>
        <p className="m-0 mt-2 text-[13.5px] leading-relaxed text-muted">
          Six things about PUMMA you would never guess on your own — and you
          drive. No feature tour, no checklist of buttons.
        </p>

        <div className="mt-6 grid grid-cols-2 gap-2.5">
          <button
            type="button"
            onClick={onSkip}
            disabled={stage === 2}
            style={lane(true)}
            className={cn(
              "flex items-center justify-center gap-2 rounded-xl border-2 px-3 py-3 text-[13.5px] font-bold transition-[transform,background-color,border-color,color] duration-500 [transition-timing-function:cubic-bezier(0.34,1.4,0.64,1)]",
              stage === 2
                ? "border-primary bg-primary text-background"
                : "border-tasks/50 text-tasks hover:bg-tasks/10",
            )}
          >
            {stage === 2 ? (
              <Play className="h-3.5 w-3.5 shrink-0 fill-current" />
            ) : (
              <X className="h-3.5 w-3.5 shrink-0" />
            )}
            <span className="truncate">
              {stage === 2 ? "starting…" : "Skip"}
            </span>
          </button>

          <button
            type="button"
            onClick={onStart}
            disabled={stage === 2}
            style={lane(false)}
            className="flex items-center justify-center gap-2 rounded-xl bg-ink px-3 py-3 text-[13.5px] font-bold text-background transition-[transform,opacity] duration-500 [transition-timing-function:cubic-bezier(0.34,1.4,0.64,1)] disabled:opacity-40"
          >
            <Play className="h-3.5 w-3.5 shrink-0 fill-current" />
            <span className="truncate">Let&apos;s go</span>
          </button>
        </div>

        <p
          className={cn(
            "m-0 mt-3 text-center font-mono text-[10.5px] transition-colors duration-300",
            stage === 2 ? "font-semibold text-primary" : "text-faint2",
          )}
        >
          {stage === 0 && "60 seconds. You can spare it."}
          {stage === 1 && "↔ they swapped. try again."}
          {stage === 2 && "skipped successfully ✓ … starting tutorial"}
        </p>
      </div>
    </div>
  );
}
