"use client";

import { createContext, useCallback, useContext, useState } from "react";
import { lookById, type LookId } from "@/lib/themes";

type LookState = {
  look: LookId;
  /** Put a look on the page now. Saving it is the caller's to do. */
  show: (id: LookId) => void;
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
 * arrives in one look and flips to another. This only carries the choice to
 * the bulb's menu and repaints at once when a look is picked there, without
 * waiting for the save.
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
  const show = useCallback((id: LookId) => {
    setLook(id);
    apply(id);
  }, []);
  return (
    <LookContext.Provider value={{ look, show }}>{children}</LookContext.Provider>
  );
}

export function useLook(): LookState {
  const state = useContext(LookContext);
  if (!state) throw new Error("useLook needs a LookProvider above it");
  return state;
}
