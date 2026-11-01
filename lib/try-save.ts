import { unstable_rethrow } from "next/navigation";
import { toast } from "sonner";
import { toastLostConnection } from "@/lib/lost-connection";
import { catchUpNow } from "@/lib/save-catch-up";

type SaveResult = { ok: boolean; error?: string };

/** The server said no, or no answer came. */
export type SaveFailure = "refused" | "lost";

/** Runs a save. A refusal or a lost connection shows a toast, calls onFail and gives back null. */
export async function trySave<R extends SaveResult | void>(
  run: () => Promise<R> | R,
  onFail?: (why: SaveFailure) => void,
): Promise<R | null> {
  let why: SaveFailure = "lost";
  try {
    const res = await run();
    catchUpNow();
    if (!res || res.ok) return res;
    why = "refused";
    toast.error(res.error ?? "Could not save that.");
  } catch (err) {
    // A redirect passes through; anything else would reach the error boundary and take the page with it.
    unstable_rethrow(err);
    toastLostConnection();
  }
  onFail?.(why);
  return null;
}
