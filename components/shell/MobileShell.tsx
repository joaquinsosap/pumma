"use client";

import { DemoBanner } from "@/components/shell/DemoBanner";
import { AboutPummaButton } from "@/components/shell/AboutPummaButton";
import { PummaMark } from "@/components/shell/PummaMark";

/**
 * Phone header: just the brand row. Navigation lives in the floating dock
 * (MobileDock) and the More sheet — the old hamburger drawer is gone.
 * Demo accounts get a compact pill on this row (same layout as normal).
 */
export function MobileShell({
  demo,
}: {
  sidebar?: React.ReactNode;
  demo?: { expiresAt: string | null } | null;
}) {
  return (
    <div className="lg:hidden">
      <div
        className="mb-3 flex shrink-0 items-center gap-2.5"
        style={{ paddingTop: "env(safe-area-inset-top)" }}
      >
        <PummaMark className="h-7 w-7 shrink-0 rounded-lg" />
        <span className="text-[15px] font-extrabold tracking-tight">
          P.U.M.M.A
        </span>
        <AboutPummaButton />
        {demo && <DemoBanner expiresAt={demo.expiresAt} className="ml-auto" />}
      </div>
    </div>
  );
}
