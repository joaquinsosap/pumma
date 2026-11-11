"use client";

import { createContext, useCallback, useContext, useRef, useState } from "react";
import { setLook as saveLook } from "@/lib/actions/settings";
import { lookById, type LookId } from "@/lib/themes";
import { trySave } from "@/lib/try-save";

type LookState = {
  look: LookId;
  /** Put a look on the page now and save it to the account. A save that fails puts the old one back. */
  pick: (id: LookId) => void;
};

const LookContext = createContext<LookState | null>(null);

/** The three attributes on <html> the stylesheet reads a look from. */
function apply(id: LookId) {
  const look = lookById(id);
  const root = document.documentElement;
  root.setAttribute("data-palette", look.id);
  root.setAttribute("data-finish", look.finish);
  root.setAttribute("data-theme", look.mode);
}

/**
 * Which look is on the page.
 *
 * The server draws <html> with the saved look's attributes, so a page never
 * arrives in one look and flips to another. This carries the choice to the
 * pickers (the bulb's menu and the row in Settings) and repaints at once when
 * a look is picked, without waiting for the save.
 */
export function LookProvider({
  initial,
  children,
}: {
  initial: LookId;
  children: React.ReactNode;
}) {
  const [look, setLook] = useState(initial);
  // A look saved somewhere else (another tab, the phone) arrives as a new `initial`.
  const [seen, setSeen] = useState(initial);
  if (seen !== initial) {
    setSeen(initial);
    setLook(initial);
  }
  // One save at a time, for both pickers: two in flight could end with the
  // page in one look and the account in another.
  const saving = useRef(false);

  const pick = useCallback(
    (id: LookId) => {
      if (id === look || saving.current) return;
      saving.current = true;
      const was = look;
      setLook(id);
      apply(id);
      void trySave(() => saveLook(id)).then((res) => {
        saving.current = false;
        if (res) return;
        setLook(was);
        apply(was);
      });
    },
    [look],
  );

  return (
    <LookContext.Provider value={{ look, pick }}>{children}</LookContext.Provider>
  );
}

export function useLook(): LookState {
  const state = useContext(LookContext);
  if (!state) throw new Error("useLook needs a LookProvider above it");
  return state;
}
