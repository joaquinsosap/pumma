"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Calendar,
  CheckCircle2,
  FileText,
  Folder,
  Hourglass,
  House,
  ListTodo,
  MoreHorizontal,
  Plus,
  Settings,
  Sparkles,
  Target,
} from "@/components/icons";
import { LifeAreaToggle, type LifeAutoConfig, useLifeView } from "@/components/shell/LifeAreaToggle";
import { hrefWithLife } from "@/lib/life-area";
import { cn } from "@/lib/utils";

/** Section accent + capture type for the current path — shared with the
 *  top-bar twin button so both + buttons always look and act identically. */
export function sectionMetaFor(pathname: string): {
  color: string;
  captureType: "task" | "note" | "goal" | "habit";
} {
  const item = DOCK.find((d) =>
    d.href === "/" ? pathname === "/" : pathname.startsWith(d.href)
  );
  return {
    color: item?.color ?? "var(--ink)",
    captureType: item?.captureType ?? "task",
  };
}

type DockItem = {
  href: string;
  label: string;
  icon: typeof House;
  color: string;
  captureType?: "task" | "note" | "goal" | "habit";
};

const DOCK: DockItem[] = [
  { href: "/", label: "Home", icon: House, color: "var(--primary)", captureType: "task" },
  { href: "/tasks", label: "Tasks", icon: ListTodo, color: "oklch(0.64 0.18 25)", captureType: "task" },
  { href: "/calendar", label: "Calendar", icon: Calendar, color: "oklch(0.58 0.14 245)", captureType: "task" },
  { href: "/notes", label: "Notes", icon: FileText, color: "oklch(0.7 0.12 70)", captureType: "note" },
];

const MORE: { href: string; label: string; icon: typeof House; color: string }[] = [
  { href: "/habits", label: "Habits", icon: CheckCircle2, color: "oklch(0.6 0.13 155)" },
  { href: "/goals", label: "Goals", icon: Target, color: "oklch(0.58 0.17 300)" },
  { href: "/projects", label: "Projects", icon: Folder, color: "oklch(0.58 0.14 245)" },
  { href: "/life", label: "Life calendar", icon: Hourglass, color: "oklch(0.7 0.12 70)" },
  { href: "/assistant", label: "Assistant", icon: Sparkles, color: "var(--primary)" },
];

/**
 * Phone navigation: a floating pill dock. The active tab grows into a colored
 * pill with its label, and a contextual mini-FAB blooms above the dock to
 * capture into the section you're looking at. "More" opens a sheet with the
 * rest of the nav + the Personal/Work toggle (replaces the old drawer).
 */
export function MobileDock({ lifeAuto }: { lifeAuto?: LifeAutoConfig }) {
  const pathname = usePathname();
  const [life] = useLifeView();
  const [moreOpen, setMoreOpen] = useState(false);

  // Any capture opening (dock +, top-bar twin, keyboard) dismisses the menu.
  useEffect(() => {
    const close = () => setMoreOpen(false);
    window.addEventListener("pumma:capture", close);
    window.addEventListener("pumma:capture-opening", close);
    return () => {
      window.removeEventListener("pumma:capture", close);
      window.removeEventListener("pumma:capture-opening", close);
    };
  }, []);

  const activeItem =
    DOCK.find((d) => (d.href === "/" ? pathname === "/" : pathname.startsWith(d.href))) ?? null;
  const moreActive = !activeItem && MORE.some((m) => pathname.startsWith(m.href));

  const openCapture = (type?: string) => {
    window.dispatchEvent(
      new CustomEvent("pumma:capture", { detail: { type: type ?? "task" } })
    );
  };

  return (
    <>
      {moreOpen && (
        <button
          type="button"
          aria-label="Close menu"
          onClick={() => setMoreOpen(false)}
          className="animate-pumma-fade fixed inset-0 z-[39] bg-black/25 lg:hidden"
        />
      )}
      <div
        className="pointer-events-none fixed inset-x-0 z-40 flex justify-center lg:hidden"
        style={{ bottom: "calc(0.75rem + env(safe-area-inset-bottom))" }}
      >
        <div className="relative flex w-full max-w-[440px] items-center justify-between px-3">
        {/* The "More" bloom: a floating glass panel above the dock — fixed
            height on purpose (it's a menu, not a sheet). */}
        {moreOpen && (
          <div className="animate-pumma-bloom pointer-events-auto absolute inset-x-3 bottom-[calc(100%+12px)] max-h-[calc(100dvh-140px)] overflow-y-auto rounded-2xl border border-border bg-surface/95 p-3.5 shadow-[0_16px_48px_rgba(0,0,0,0.28)] backdrop-blur-xl">
            <p className="animate-pumma-rise mb-1.5 font-mono text-[10px] font-semibold uppercase tracking-widest text-faint2">
              Spaces
            </p>
            <div className="grid grid-cols-2 gap-1.5">
              {MORE.map((item, i) => {
                const Icon = item.icon;
                const active = pathname.startsWith(item.href);
                return (
                  <Link
                    key={item.href}
                    href={hrefWithLife(item.href, life)}
                    onClick={() => setMoreOpen(false)}
                    className={cn(
                      "animate-pumma-rise flex items-center gap-2.5 rounded-xl border-2 px-3 py-3 text-[13px] font-semibold transition-all duration-150 active:scale-95",
                      !active && "border-border bg-surface text-muted"
                    )}
                    style={{
                      animationDelay: `${30 + i * 30}ms`,
                      ...(active
                        ? {
                            borderColor: item.color,
                            background: item.color.includes("oklch")
                              ? item.color.replace(")", " / 0.12)")
                              : "var(--hover)",
                            color: "var(--ink)",
                          }
                        : {}),
                    }}
                  >
                    <Icon
                      className="h-[18px] w-[18px]"
                      strokeWidth={2.2}
                      style={{ color: item.color }}
                    />
                    {item.label}
                  </Link>
                );
              })}
            </div>
            <p
              className="animate-pumma-rise mb-1.5 mt-3.5 font-mono text-[10px] font-semibold uppercase tracking-widest text-faint2"
              style={{ animationDelay: "160ms" }}
            >
              Life area
            </p>
            <div className="animate-pumma-rise" style={{ animationDelay: "190ms" }}>
              <LifeAreaToggle variant="fun" auto={lifeAuto} className="mb-0" />
            </div>
          </div>
        )}
        <Link
          href={hrefWithLife("/settings", life)}
          onClick={() => setMoreOpen(false)}
          aria-label="Settings"
          className={cn(
            "pointer-events-auto flex h-10 w-10 items-center justify-center rounded-full border bg-surface/80 shadow-[0_4px_14px_rgba(0,0,0,0.18)] backdrop-blur-md transition-colors",
            pathname.startsWith("/settings")
              ? "border-faint2 text-ink"
              : "border-border text-muted"
          )}
        >
          <Settings className="h-[18px] w-[18px]" strokeWidth={2} />
        </Link>
        <div className="pointer-events-auto flex items-center gap-0.5 rounded-full border border-border bg-surface/80 px-1.5 py-1.5 shadow-[0_6px_24px_rgba(0,0,0,0.22)] backdrop-blur-md">
          {DOCK.map((item) => {
            const active = item === activeItem;
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={hrefWithLife(item.href, life)}
                onClick={() => setMoreOpen(false)}
                aria-label={item.label}
                className={cn(
                  "flex items-center gap-1.5 rounded-full transition-all duration-200",
                  active ? "px-3.5 py-2.5" : "p-2.5 text-muted"
                )}
                style={
                  active
                    ? {
                        color: item.color.includes("oklch")
                          ? item.color.replace(")", " / 0.95)")
                          : item.color,
                        background: item.color.includes("oklch")
                          ? item.color.replace(")", " / 0.14)")
                          : "var(--hover)",
                      }
                    : undefined
                }
              >
                <Icon
                  className={cn(
                    "shrink-0 transition-transform duration-200",
                    active ? "h-[22px] w-[22px]" : "h-[19px] w-[19px]"
                  )}
                  strokeWidth={active ? 2.4 : 2}
                />
                {active && (
                  <span className="text-[12px] font-bold">{item.label}</span>
                )}
              </Link>
            );
          })}
          <button
            type="button"
            aria-label="More"
            onClick={() => setMoreOpen((v) => !v)}
            className={cn(
              "group flex items-center rounded-full p-2.5 transition-all duration-200 active:scale-90",
              moreOpen
                ? "bg-primary/15 text-primary shadow-[inset_0_0_0_1.5px_var(--primary)]"
                : moreActive
                  ? "bg-hover text-ink"
                  : "text-muted"
            )}
          >
            <MoreHorizontal
              className={cn(
                "h-[19px] w-[19px] transition-transform duration-200 group-active:rotate-90",
                moreOpen && "rotate-90"
              )}
              strokeWidth={2}
            />
          </button>
        </div>
        {/* Standalone capture shortcut — twin of the one next to the top bar */}
        <button
          key={activeItem?.color ?? "ink"}
          type="button"
          aria-label="Capture"
          onClick={() => {
            setMoreOpen(false);
            openCapture(activeItem?.captureType ?? "task");
          }}
          className="pointer-events-auto group flex h-10 w-10 animate-pumma-pop items-center justify-center rounded-full border-2 border-background text-background shadow-[0_4px_14px_rgba(0,0,0,0.25)] transition-all duration-300 hover:scale-105 active:scale-90"
          style={{ background: activeItem?.color ?? "var(--ink)" }}
        >
          <Plus
            className="h-[18px] w-[18px] transition-transform duration-200 group-active:rotate-90"
            strokeWidth={2.6}
          />
        </button>
        </div>
      </div>

    </>
  );
}
