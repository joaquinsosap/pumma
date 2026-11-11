"use client";

import { useEffect } from "react";
import { DbConnectionErrorView } from "@/components/errors/DbConnectionErrorView";
import { NoConnectionView } from "@/components/errors/NoConnectionView";
import { useLostConnectionRecovery } from "@/lib/lost-connection";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const recovery = useLostConnectionRecovery(error, reset);
  useEffect(() => {
    if (recovery === "none") console.error(error);
  }, [error, recovery]);

  return (
    <html lang="en">
      <body className="antialiased">
        {recovery === "waiting" && <NoConnectionView />}
        {recovery === "none" && (
          <DbConnectionErrorView error={error} reset={reset} />
        )}
      </body>
    </html>
  );
}
