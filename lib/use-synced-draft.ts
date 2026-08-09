import { useEffect, useState, type Dispatch, type SetStateAction } from "react";

/** Local draft that only resets when the entity key changes (not on every refresh). */
export function useSyncedDraft<T>(
  serverValue: T,
  entityKey: string,
): [T, Dispatch<SetStateAction<T>>] {
  const [draft, setDraft] = useState(serverValue);

  useEffect(() => {
    setDraft(serverValue);
  }, [entityKey]);

  return [draft, setDraft];
}
