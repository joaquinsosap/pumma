// A task the capture bar just made, handed to whichever board ends up showing it.
//
// The bar and the board share no parent worth threading a prop through, and the
// card only exists once the server has answered. So the bar says "this id, from
// here", and the board that finds a card with that id brings it in from there.

export type NewTaskArrival = {
  id: string;
  /** Where the bar was on screen, or null when there was no bar to fly from. */
  from: DOMRect | null;
  at: number;
};

/** A card that turns up later than this was not "just added" any more. */
export const ARRIVAL_WINDOW_MS = 6000;

const listeners = new Set<(arrival: NewTaskArrival) => void>();

export function announceNewTask(id: string, from: DOMRect | null): void {
  const arrival = { id, from, at: Date.now() };
  for (const hear of listeners) hear(arrival);
}

export function onNewTask(hear: (arrival: NewTaskArrival) => void): () => void {
  listeners.add(hear);
  return () => {
    listeners.delete(hear);
  };
}

/** Still inside the window in which a new card should be shown arriving. */
export function arrivalIsFresh(arrival: NewTaskArrival, now: number): boolean {
  return now - arrival.at <= ARRIVAL_WINDOW_MS;
}
