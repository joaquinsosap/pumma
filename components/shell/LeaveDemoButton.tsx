"use client";

import { useState } from "react";
import { signOut } from "@/lib/auth/client";
import { cn } from "@/lib/utils";

/**
 * Demo accounts can't subscribe (they're deleted on schedule) — leaving the
 * demo session first ensures the paid subscription lands on a real account.
 */
export function LeaveDemoButton({
  className,
  children = "Keep a real account →",
}: {
  className?: string;
  children?: React.ReactNode;
}) {
  const [pending, setPending] = useState(false);
  const handle = async () => {
    setPending(true);
    try {
      await signOut();
    } finally {
      window.location.href = "/register?plan=hosted";
    }
  };
  return (
    <button
      type="button"
      onClick={handle}
      disabled={pending}
      className={cn(
        "text-[12px] font-semibold text-ink underline underline-offset-2 hover:text-primary disabled:opacity-60",
        className,
      )}
    >
      {pending ? "One sec…" : children}
    </button>
  );
}
