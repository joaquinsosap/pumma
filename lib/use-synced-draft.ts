import { useEffect, useState, type Dispatch, type SetStateAction } from "react";

/** Local copy that shows a pick at once and takes the server's value whenever that value changes. A page carrying the same value changes nothing, so a late refresh can't undo a pick. */
export function useSyncedDraft<T>(
  serverValue: T,
  entityKey: string,
): [T, Dispatch<SetStateAction<T>>] {
  const [draft, setDraft] = useState(serverValue);
  // By value: a refresh hands arrays back as new objects.
  const value = JSON.stringify(serverValue);

  useEffect(() => {
    setDraft(serverValue);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entityKey, value]);

  return [draft, setDraft];
}
