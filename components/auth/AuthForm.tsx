"use client";

import { useState } from "react";
import Link from "next/link";
import { signIn, signUp } from "@/lib/auth/client";
import { cn } from "@/lib/utils";

type Mode = "login" | "register";

export function AuthForm({
  mode,
  redirectTo = "/",
}: {
  mode: Mode;
  /** Where to land after success — /checkout/start for the hosted plan. */
  redirectTo?: string;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (pending) return;
    setError(null);
    setPending(true);
    try {
      const res =
        mode === "register"
          ? await signUp.email({
              name: name.trim() || email.split("@")[0],
              email,
              password,
            })
          : await signIn.email({ email, password });
      if (res.error) {
        setError(res.error.message ?? "Something went wrong. Try again.");
        setPending(false);
        return;
      }
      // Full navigation so the server sees the fresh session everywhere.
      window.location.href = redirectTo;
    } catch {
      setError("Something went wrong. Try again.");
      setPending(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-6 text-ink">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <Link
            href="/"
            aria-label="Back to PUMMA home"
            className="group inline-flex flex-col items-center no-underline"
          >
            <span className="mb-3 flex h-11 w-11 items-center justify-center rounded-[12px] bg-ink font-mono text-lg font-bold text-background transition-transform group-hover:-translate-y-0.5">
              P
            </span>
            <span className="text-lg font-extrabold tracking-tight text-ink">
              P.U.M.M.A
            </span>
          </Link>
          <p className="mt-1 font-mono text-[10px] uppercase tracking-widest text-faint">
            {mode === "login" ? "Welcome back" : "Create your account"}
          </p>
        </div>

        <form
          onSubmit={submit}
          className="rounded-[14px] border-2 border-ink bg-surface p-5 shadow-[3px_3px_0_var(--shadow)]"
        >
          {mode === "register" && (
            <label className="mb-3 block">
              <span className="mb-1 block font-mono text-[10px] font-semibold uppercase tracking-widest text-faint2">
                Name
              </span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoComplete="name"
                maxLength={64}
                className="w-full rounded-lg border border-border bg-background/50 px-3 py-2 text-sm outline-none focus:border-faint"
              />
            </label>
          )}
          <label className="mb-3 block">
            <span className="mb-1 block font-mono text-[10px] font-semibold uppercase tracking-widest text-faint2">
              Email
            </span>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              className="w-full rounded-lg border border-border bg-background/50 px-3 py-2 text-sm outline-none focus:border-faint"
            />
          </label>
          <label className="mb-4 block">
            <span className="mb-1 block font-mono text-[10px] font-semibold uppercase tracking-widest text-faint2">
              Password
            </span>
            <input
              type="password"
              required
              minLength={10}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={
                mode === "login" ? "current-password" : "new-password"
              }
              className="w-full rounded-lg border border-border bg-background/50 px-3 py-2 text-sm outline-none focus:border-faint"
            />
            {mode === "register" && (
              <span className="mt-1 block font-mono text-[10px] text-faint">
                At least 10 characters
              </span>
            )}
          </label>

          {error && (
            <p className="mb-3 rounded-lg border border-tasks/30 bg-tasks/[0.07] px-3 py-2 text-[12.5px] text-tasks">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={pending}
            className={cn(
              "w-full cursor-pointer rounded-lg border-none bg-ink px-4 py-2 text-[13px] font-bold text-background",
              "disabled:cursor-not-allowed disabled:opacity-60",
            )}
          >
            {pending
              ? mode === "login"
                ? "Signing in…"
                : "Creating account…"
              : mode === "login"
                ? "Sign in"
                : "Create account"}
          </button>
        </form>

        <p className="mt-4 text-center text-[12.5px] text-muted">
          {mode === "login" ? (
            <>
              No account?{" "}
              <Link
                href="/register"
                className="font-semibold text-ink underline underline-offset-2"
              >
                Create one
              </Link>
            </>
          ) : (
            <>
              Already have an account?{" "}
              <Link
                href="/login"
                className="font-semibold text-ink underline underline-offset-2"
              >
                Sign in
              </Link>
            </>
          )}
        </p>
      </div>
    </div>
  );
}
