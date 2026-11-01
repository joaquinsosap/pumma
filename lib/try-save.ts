import { unstable_rethrow } from "next/navigation";
import { toast } from "sonner";

type SaveResult = { ok: boolean; error?: string };

/** Runs a save. A refusal or a lost connection shows a toast, calls onFail and gives back null. */
export async function trySave<R extends SaveResult | void>(
  run: () => Promise<R> | R,
  onFail?: () => void,
): Promise<R | null> {
  try {
    const res = await run();
    if (!res || res.ok) return res;
    toast.error(res.error ?? "Could not save that.");
  } catch (err) {
    // A redirect passes through; anything else would reach the error boundary and take the page with it.
    unstable_rethrow(err);
    toast.error("Could not save that. Check your connection.");
  }
  onFail?.();
  return null;
}
