"use client";

import { useEffect } from "react";
import { DbConnectionErrorView } from "@/components/errors/DbConnectionErrorView";
import { useLostConnectionRecovery } from "@/lib/lost-connection";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const recovering = useLostConnectionRecovery(error, reset);
  useEffect(() => {
    if (!recovering) console.error(error);
  }, [error, recovering]);

  return (
    <html lang="en">
      <body className="antialiased">
        {!recovering && <DbConnectionErrorView error={error} reset={reset} />}
      </body>
    </html>
  );
}
