"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useQueryState, parseAsStringLiteral } from "nuqs";
import {
  Briefcase,
  Hand,
  Heart,
  Layers,
  Minus,
  Plus,
  Zap,
} from "@/components/icons";
import {
  LIFE_AREA_COOKIE,
  parseLifeView,
  hrefWithLife,
  type LifeView,
} from "@/lib/life-area";
import { formatTimeHM, iso, parseTimeToMinutes } from "@/lib/date";
import { useTimezone } from "@/components/shell/TimeZoneProvider";
import { useSyncedDraft } from "@/lib/use-synced-draft";
import { updateSettingsAction } from "@/lib/actions/settings";
import { cn } from "@/lib/utils";

const options = ["both", "personal", "work"] as const;

const labels: Record<(typeof options)[number], string> = {
  both: "Both",
  personal: "Personal",
  work: "Work",
};

export type LifeAutoConfig = {
  enabled: boolean;
  workStart: string; // "HH:MM"
  workEnd: string;
  workDays: number[]; // JS getDay(): 0=Sun … 6=Sat
  overrideMins: number;
};

/** Manual-override marker: while now < until, the auto-switcher stays hands-off. */
const OVERRIDE_KEY = "pumma-life-override";

function readOverrideUntil(): number | null {
  try {
    const raw = window.localStorage.getItem(OVERRIDE_KEY);
    if (!raw) return null;
    const until = Number(raw);
    return Number.isFinite(until) ? until : null;
  } catch {
    return null;
  }
}

function writeOverrideUntil(until: number | null) {
  try {
    if (until === null) window.localStorage.removeItem(OVERRIDE_KEY);
    else window.localStorage.setItem(OVERRIDE_KEY, String(until));
  } catch {
    // localStorage unavailable (private mode) — auto-switch just won't hold overrides.
  }
}

/** Which mode the clock says we should be in right now. */
function scheduledMode(cfg: LifeAutoConfig, timeZone: string): LifeView {
  const now = new Date();
  const dow = new Date(iso(now, timeZone) + "T00:00").getDay();
  if (!cfg.workDays.includes(dow)) return "personal";
  const mins = parseTimeToMinutes(formatTimeHM(now, timeZone));
  const start = parseTimeToMinutes(cfg.workStart);
  const end = parseTimeToMinutes(cfg.workEnd);
  const inWindow =
    start <= end ? mins >= start && mins < end : mins >= start || mins < end;
  return inWindow ? "work" : "personal";
}

function readLifeCookie(): LifeView {
  if (typeof document === "undefined") return "both";
  const match = document.cookie.match(/(?:^|;\s*)pumma-life=([^;]*)/);
  return parseLifeView(match?.[1]);
}

export function LifeAreaToggle({
  className,
  auto,
  variant = "default",
}: {
  className?: string;
  auto?: LifeAutoConfig;
  /** "fun" = the colorful touch-first version used in the phone dock menu. */
  variant?: "default" | "fun";
}) {
  const router = useRouter();
  const timeZone = useTimezone();
  const syncedFromCookie = useRef(false);
  const [life, setLife] = useQueryState(
    "life",
    parseAsStringLiteral(options).withDefault("both"),
  );
  // Ticks every 30s so the schedule check and countdown label stay current.
  // Also gates the indicator to post-mount (its text depends on the clock, so
  // rendering it during SSR would hydrate-mismatch).
  const [now, setNow] = useState<number | null>(null);

  // Keep URL in sync with saved preference when landing without ?life=
  useEffect(() => {
    if (syncedFromCookie.current) return;
    syncedFromCookie.current = true;
    const params = new URLSearchParams(window.location.search);
    if (params.has("life")) return;
    const stored = readLifeCookie();
    if (stored !== life) {
      void setLife(stored);
    }
  }, [life, setLife]);

  const apply = (next: LifeView) => {
    document.cookie = `${LIFE_AREA_COOKIE}=${next}; path=/; max-age=31536000; SameSite=Lax`;
    void setLife(next).then(() => router.refresh());
  };

  // The auto-switcher: follow the work-hours schedule unless a manual override
  // is still fresh. Runs on mount and every 30s. The enabled flag is mirrored
  // optimistically so the toggle flips the instant it's tapped instead of
  // waiting for the server round-trip + refresh.
  const [optimisticEnabled, setOptimisticEnabled] = useState<boolean | null>(
    null,
  );
  const enabled = optimisticEnabled ?? auto?.enabled ?? false;
  useEffect(() => {
    setOptimisticEnabled(null);
  }, [auto?.enabled]);
  useEffect(() => {
    if (!enabled || !auto) return;
    const tick = () => {
      setNow(Date.now());
      const until = readOverrideUntil();
      if (until !== null) {
        if (Date.now() < until) return; // user's pick still holds
        writeOverrideUntil(null);
      }
      const target = scheduledMode(auto, timeZone);
      if (readLifeCookie() !== target) apply(target);
    };
    tick();
    const id = window.setInterval(tick, 30_000);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    enabled,
    auto?.workStart,
    auto?.workEnd,
    auto?.overrideMins,
    auto?.workDays.join(","),
    timeZone,
  ]);

  const select = (next: LifeView) => {
    if (next === life) return;
    if (enabled && auto) {
      // Picking what the schedule wants anyway = back on autopilot;
      // anything else holds for the configured override window.
      if (next === scheduledMode(auto, timeZone)) writeOverrideUntil(null);
      else writeOverrideUntil(Date.now() + auto.overrideMins * 60_000);
      setNow(Date.now());
    }
    apply(next);
  };

  // Indicator label (client-only): "auto" when following the schedule, or the
  // countdown until the schedule takes back over. Gated to post-mount since
  // it depends on the clock (SSR would hydrate-mismatch otherwise).
  let indicator: string | null = null;
  if (enabled && now !== null) {
    const until = readOverrideUntil();
    if (until !== null && until > now) {
      indicator = `auto in ${Math.max(1, Math.ceil((until - now) / 60_000))}m`;
    } else {
      indicator = "auto";
    }
  }

  const [savingAutoSwitch, startAutoSwitchTransition] = useTransition();
  const setAutoSwitch = (nextEnabled: boolean) => {
    if (nextEnabled === enabled) return;
    setOptimisticEnabled(nextEnabled);
    startAutoSwitchTransition(async () => {
      await updateSettingsAction({ lifeAutoSwitch: nextEnabled });
      router.refresh();
    });
  };

  // Override-window minutes editor. Keyed on a constant so a local edit isn't
  // blown away by a router.refresh() before the new value round-trips back.
  const [minsDraft, setMinsDraft] = useSyncedDraft(
    String(auto?.overrideMins ?? 60),
    "life-auto-override-mins",
  );
  const [, startMinsTransition] = useTransition();
  const commitMins = () => {
    const n = Math.round(Number(minsDraft));
    const fallback = String(auto?.overrideMins ?? 60);
    if (!Number.isFinite(n) || n < 5 || n > 720) {
      setMinsDraft(fallback);
      return;
    }
    setMinsDraft(String(n));
    if (n === auto?.overrideMins) return;
    startMinsTransition(async () => {
      await updateSettingsAction({ lifeAutoOverrideMins: n });
      router.refresh();
    });
  };

  // Touch stepper for the hold window: bump ±15m, commit after taps settle so
  // rapid tapping doesn't fire a server action per tap.
  const stepTimer = useRef<number | null>(null);
  // Latest stepped value lives in a ref so rapid taps (same frame, before a
  // re-render lands) still accumulate instead of re-reading a stale draft.
  const stepValue = useRef<number | null>(null);
  const stepMins = (delta: number) => {
    const cur = Math.round(Number(minsDraft));
    const base =
      stepValue.current ??
      (Number.isFinite(cur) && cur >= 5 ? cur : (auto?.overrideMins ?? 60));
    const n = Math.min(720, Math.max(5, base + delta));
    stepValue.current = n;
    setMinsDraft(String(n));
    if (stepTimer.current) window.clearTimeout(stepTimer.current);
    stepTimer.current = window.setTimeout(() => {
      stepValue.current = null;
      if (n === auto?.overrideMins) return;
      startMinsTransition(async () => {
        await updateSettingsAction({ lifeAutoOverrideMins: n });
        router.refresh();
      });
    }, 600);
  };

  const holdMins = (() => {
    const n = Math.round(Number(minsDraft));
    return Number.isFinite(n) && n >= 5 ? n : (auto?.overrideMins ?? 60);
  })();
  const holdLabel =
    holdMins < 60
      ? `${holdMins}m`
      : holdMins % 60
        ? `${Math.floor(holdMins / 60)}h ${holdMins % 60}m`
        : `${Math.floor(holdMins / 60)}h`;

  if (variant === "fun") {
    const FUN: {
      key: LifeView;
      label: string;
      icon: typeof Heart;
      color: string;
    }[] = [
      {
        key: "personal",
        label: "Personal",
        icon: Heart,
        color: "oklch(0.58 0.17 300)",
      },
      { key: "both", label: "Both", icon: Layers, color: "var(--muted)" },
      {
        key: "work",
        label: "Work",
        icon: Briefcase,
        color: "oklch(0.58 0.14 245)",
      },
    ];
    return (
      <div className={className}>
        <div className="grid grid-cols-3 gap-1.5">
          {FUN.map(({ key, label, icon: Icon, color }) => {
            const active = life === key;
            const isBoth = key === "both";
            return (
              <button
                key={key}
                type="button"
                onClick={() => select(key)}
                className={cn(
                  "flex flex-col items-center gap-1 rounded-xl border-2 px-1 py-2.5 text-[11px] font-semibold transition-all duration-150 active:scale-95",
                  !active && "border-border bg-surface text-muted",
                )}
                style={
                  active
                    ? {
                        borderColor: isBoth ? "var(--faint2)" : color,
                        background: isBoth
                          ? "linear-gradient(135deg, oklch(0.58 0.17 300 / 0.1), oklch(0.58 0.14 245 / 0.1))"
                          : color.replace(")", " / 0.12)"),
                        color: "var(--ink)",
                      }
                    : undefined
                }
              >
                <Icon
                  className="h-[18px] w-[18px]"
                  strokeWidth={2.2}
                  style={{ color }}
                />
                {label}
              </button>
            );
          })}
        </div>
        {auto && (
          <>
            <div className="mt-2 grid grid-cols-2 gap-1.5">
              {(
                [
                  {
                    mode: "manual",
                    label: "Manual",
                    icon: Hand,
                    color: "oklch(0.7 0.12 70)",
                  },
                  {
                    mode: "auto",
                    label: "Auto",
                    icon: Zap,
                    color: "oklch(0.6 0.13 155)",
                  },
                ] as const
              ).map(({ mode, label, icon: Icon, color }) => {
                const active = mode === "auto" ? enabled : !enabled;
                return (
                  <button
                    key={mode}
                    type="button"
                    disabled={savingAutoSwitch}
                    onClick={() => setAutoSwitch(mode === "auto")}
                    className={cn(
                      "flex items-center justify-center gap-1.5 rounded-xl border-2 px-2 py-2 text-[11px] font-semibold transition-all duration-150 active:scale-95 disabled:opacity-50",
                      !active && "border-border bg-surface text-muted",
                    )}
                    style={
                      active
                        ? {
                            borderColor: color,
                            background: color.replace(")", " / 0.12)"),
                            color: "var(--ink)",
                          }
                        : undefined
                    }
                  >
                    <Icon
                      className="h-3.5 w-3.5"
                      strokeWidth={2.2}
                      style={{ color }}
                    />
                    {label}
                  </button>
                );
              })}
            </div>
            {enabled && (
              <div className="mt-1.5 flex items-center justify-between rounded-xl border border-border bg-surface py-1.5 pl-3 pr-1.5">
                <span
                  className="font-mono text-[9px] font-semibold uppercase tracking-widest text-faint2"
                  title="Minutes a manual pick holds before auto takes back over"
                >
                  Hold picks for
                </span>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    aria-label="Hold 15 minutes less"
                    onClick={() => stepMins(-15)}
                    className="flex h-7 w-7 items-center justify-center rounded-lg border border-border text-muted transition-all duration-150 active:scale-90"
                  >
                    <Minus className="h-3.5 w-3.5" strokeWidth={2.4} />
                  </button>
                  <span className="w-[52px] text-center font-mono text-[12px] font-bold text-ink">
                    {holdLabel}
                  </span>
                  <button
                    type="button"
                    aria-label="Hold 15 minutes more"
                    onClick={() => stepMins(15)}
                    className="flex h-7 w-7 items-center justify-center rounded-lg border border-border text-muted transition-all duration-150 active:scale-90"
                  >
                    <Plus className="h-3.5 w-3.5" strokeWidth={2.4} />
                  </button>
                </div>
              </div>
            )}
            {enabled && indicator && (
              <p className="mt-1.5 px-1 font-mono text-[9.5px] text-faint2">
                {indicator === "auto"
                  ? "⚡ following your work-hours schedule"
                  : `✋ holding your pick, back to ${indicator}`}
              </p>
            )}
          </>
        )}
      </div>
    );
  }

  return (
    <div className={cn("mb-3", className)}>
      <div className="grid grid-cols-3 gap-1 rounded-lg border border-border bg-surface p-1">
        {options.map((key) => {
          const active = life === key;
          return (
            <button
              key={key}
              type="button"
              onClick={() => select(key)}
              className={cn(
                "rounded-md px-1.5 py-2 text-[11px] font-semibold transition-colors",
                active
                  ? key === "work"
                    ? "bg-[oklch(0.58_0.14_245/0.14)] text-[oklch(0.44_0.14_245)]"
                    : key === "personal"
                      ? "bg-[oklch(0.58_0.17_300/0.14)] text-[oklch(0.46_0.17_300)]"
                      : "bg-hover text-ink"
                  : "text-muted hover:bg-hover",
              )}
            >
              {labels[key]}
            </button>
          );
        })}
      </div>
      {auto && (
        <div className="mt-1 flex items-center justify-between gap-1.5 px-0.5">
          <div
            className="flex items-center gap-0.5 rounded-md border border-border p-0.5"
            title="Manual: Personal/Work/Both stays where you set it. Auto: it follows your work-hours schedule (Settings → Life areas)."
          >
            {(["manual", "auto"] as const).map((mode) => {
              const active = mode === "auto" ? enabled : !enabled;
              return (
                <button
                  key={mode}
                  type="button"
                  disabled={savingAutoSwitch}
                  onClick={() => setAutoSwitch(mode === "auto")}
                  className={cn(
                    "rounded px-1.5 py-0.5 font-mono text-[9px] font-semibold lowercase tracking-wide transition-colors disabled:opacity-50",
                    active
                      ? "bg-hover text-ink"
                      : "text-faint2 hover:text-muted",
                  )}
                >
                  {mode}
                </button>
              );
            })}
          </div>
          {enabled && (
            <div className="flex items-center gap-1.5 font-mono text-[9px] text-faint2">
              {indicator && (
                <span title="Auto life-area switch is on (Settings → Life areas)">
                  {indicator}
                </span>
              )}
              <label
                className="flex items-center gap-0.5"
                title="Minutes a manual pick holds before auto takes back over (5 to 720)"
              >
                <input
                  type="number"
                  min={5}
                  max={720}
                  value={minsDraft}
                  onChange={(e) => setMinsDraft(e.target.value)}
                  onBlur={commitMins}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") e.currentTarget.blur();
                  }}
                  className="w-8 border-none bg-transparent text-right font-mono text-[9px] text-faint2 outline-none focus:text-ink"
                />
                m
              </label>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function useLifeView() {
  return useQueryState(
    "life",
    parseAsStringLiteral(options).withDefault("both"),
  );
}

/** @deprecated use useLifeView */
export const useLifeArea = useLifeView;

export { hrefWithLife as hrefWithAppParams };
