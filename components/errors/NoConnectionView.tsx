"use client";

/** Shown while a page that can't load without a connection waits for one. It goes back to the page by itself. */
export function NoConnectionView() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-6 py-12 text-ink">
      <div
        role="status"
        className="w-full max-w-lg rounded-[13px] border border-border bg-surface px-6 py-8 shadow-sm"
      >
        <h1 className="text-lg font-bold">No connection</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted">
          This page needs the server. It comes back by itself as soon as the
          connection does.
        </p>
      </div>
    </div>
  );
}
