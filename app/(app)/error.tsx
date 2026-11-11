"use client";

import { useEffect } from "react";
import { DbConnectionErrorView } from "@/components/errors/DbConnectionErrorView";
import { NoConnectionView } from "@/components/errors/NoConnectionView";
import { useLostConnectionRecovery } from "@/lib/lost-connection";

export default function AppError({
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

  if (recovery === "now") return null;
  if (recovery === "waiting") return <NoConnectionView />;
  return <DbConnectionErrorView error={error} reset={reset} />;
}
