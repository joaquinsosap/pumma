"use client";

import { useCallback, useEffect, useState } from "react";
import { NUDGE_LABELS, NUDGE_SUBJECT, type NudgeVerdict } from "@/lib/nudge";
import {
  answerNudgeAction,
  recordNudgeChoiceAction,
} from "@/lib/actions/settings";
import type { NudgeKey } from "@/lib/nudge";
import { cn } from "@/lib/utils";

/**
 * The one-time offer to make a habit the default.
 *
 * Rules that matter more than the markup:
 *
 * - It appears AFTER a successful capture, never before. Nothing may stand
 *   between the user and their save.
 * - It appears at most once per setting, ever. Dismissing spends it exactly
 *   as accepting does, so a "no" is respected permanently rather than being
 *   asked again next week.
 * - Any other click is a dismissal. An offer you have to aim at to escape is
 *   a nag, and this is a suggestion.
 * - It never blocks. No overlay, no focus trap: the capture bar keeps
 *   working underneath while this sits beside it.
 */
export function useNudgeOffer() {
  const [offer, setOffer] = useState<NudgeVerdict | null>(null);

  /**
   * Record one creation-time choice and raise an offer if the trail earns
   * it. Fire and forget: a failure here must never surface, because the
   * user's actual work already succeeded and this is a nicety.
   */
  const record = useCallback((key: NudgeKey, value: string | null) => {
    if (value === null) return;
    void recordNudgeChoiceAction(key, value).then((res) => {
      if (res.ok && res.data?.suggest) setOffer(res.data.suggest);
    });
  }, []);

  const answer = useCallback(
    (accept: boolean) => {
      const current = offer;
      if (!current) return;
      // Clear first: the answer is a server round trip and the popover has
      // already done its job on screen.
      setOffer(null);
      void answerNudgeAction(current.key, accept, current.value);
    },
    [offer],
  );

  // Any click that is not one of the offer's own buttons is a "no". An
  // offer you have to aim at in order to escape is a nag; this one gets out
  // of the way the moment attention moves. Registered only while an offer is
  // up, and on the next tick so the click that produced it cannot dismiss it.
  useEffect(() => {
    if (!offer) return;
    let armed = false;
    const arm = requestAnimationFrame(() => {
      armed = true;
    });
    const onDown = (e: MouseEvent | TouchEvent) => {
      if (!armed) return;
      const el = e.target as HTMLElement | null;
      if (el?.closest?.("[data-nudge-offer]")) return;
      answer(false);
    };
    window.addEventListener("pointerdown", onDown as EventListener);
    return () => {
      cancelAnimationFrame(arm);
      window.removeEventListener("pointerdown", onDown as EventListener);
    };
  }, [offer, answer]);

  return { offer, record, answer };
}

export function NudgeOffer({
  offer,
  onAnswer,
  className,
}: {
  offer: NudgeVerdict | null;
  onAnswer: (accept: boolean) => void;
  className?: string;
}) {
  if (!offer) return null;
  const label = NUDGE_LABELS[offer.value] ?? offer.value;

  return (
    <div
      data-nudge-offer
      role="status"
      className={cn(
        "r-square r-card animate-pumma-rise flex items-center gap-2.5 border border-black bg-surface px-3 py-2 shadow-[3px_3px_0_var(--shadow)]",
        className,
      )}
    >
      <span className="min-w-0 font-mono text-[11px] leading-tight text-muted">
        <span className="font-bold text-ink">{label}</span> every time. Make it{" "}
        {NUDGE_SUBJECT[offer.key]}?
      </span>
      <span className="ml-auto flex shrink-0 items-center gap-1.5">
        <button
          type="button"
          onClick={() => onAnswer(true)}
          className="r-out r-gold px-2 py-1 font-mono text-[11px] font-bold"
        >
          Yes
        </button>
        <button
          type="button"
          onClick={() => onAnswer(false)}
          className="px-1.5 py-1 font-mono text-[11px] text-faint hover:text-ink"
        >
          No
        </button>
      </span>
    </div>
  );
}
