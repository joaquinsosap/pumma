"use client";

import { useCallback } from "react";
import { useRouter } from "next/navigation";
import { trySave } from "@/lib/try-save";

/** trySave for screens that write the address. Next throws away a save's page when the address moves while it runs, so this asks for another. */
export function useTrySave(): typeof trySave {
  const router = useRouter();
  return useCallback<typeof trySave>(
    async (run, onFail) => {
      const address = window.location.href;
      const res = await trySave(run, onFail);
      if (window.location.href !== address) router.refresh();
      return res;
    },
    [router],
  );
}
