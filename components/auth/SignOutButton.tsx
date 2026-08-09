"use client";

import { useState } from "react";
import { LogOut } from "@/components/icons";
import { signOut } from "@/lib/auth/client";
import { cn } from "@/lib/utils";

/**
 * Ends the Better Auth session and does a full navigation to /login so every
 * server component re-renders without the session. Rendered in two shapes:
 * a compact icon (sidebar) and a full-width button (settings).
 */
export function SignOutButton({
  variant = "icon",
  className,
}: {
  variant?: "icon" | "button";
  className?: string;
}) {
  const [pending, setPending] = useState(false);

  const handle = async () => {
    setPending(true);
    try {
      await signOut();
    } finally {
      window.location.href = "/login";
    }
  };

  if (variant === "icon") {
    return (
      <button
        type="button"
        onClick={handle}
        disabled={pending}
        title="Sign out"
        aria-label="Sign out"
        className={cn(
          "flex h-7 w-7 shrink-0 items-center justify-center rounded-[7px] text-faint transition-colors hover:bg-hover hover:text-tasks disabled:opacity-50",
          className
        )}
      >
        <LogOut className="h-4 w-4" strokeWidth={2} />
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={handle}
      disabled={pending}
      className={cn(
        "flex items-center justify-center gap-2 rounded-lg border border-tasks/30 bg-tasks/[0.06] px-3 py-2 text-[13px] font-semibold text-tasks transition-colors hover:border-tasks/50 hover:bg-tasks/10 disabled:opacity-50",
        className
      )}
    >
      <LogOut className="h-4 w-4" />
      {pending ? "Signing out…" : "Sign out"}
    </button>
  );
}
