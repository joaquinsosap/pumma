"use client";

import { useEffect, useRef, useState } from "react";
import { meetingBodiesAction } from "@/lib/actions/agenda";

/**
 * Invite bodies for the day on screen, keyed by event id.
 *
 * A meeting body is two or three kilobytes of join links and boilerplate, and
 * a subscribed calendar holds hundreds of them. Shipping them all with the
 * page was the single most expensive thing the app did, so the page arrives
 * with only the day it opened on and the rest are fetched as they are needed.
 *
 * Days already seen are kept: flicking back and forth across a week should
 * not re-ask for the same text, and the map is small enough that letting it
 * grow over a session costs nothing.
 */
export function useMeetingBodies(
  initial: Record<string, string>,
  day: string,
): Record<string, string> {
  const [bodies, setBodies] = useState(initial);
  // Which days we have already resolved. The day the page rendered for is in
  // here from the start, so the common case makes no request at all.
  const loaded = useRef(new Set<string>());
  const initialDay = useRef(day);

  useEffect(() => {
    loaded.current.add(initialDay.current);
  }, []);

  useEffect(() => {
    if (loaded.current.has(day)) return;
    loaded.current.add(day);
    let live = true;
    meetingBodiesAction(day)
      .then((next) => {
        if (live) setBodies((prev) => ({ ...prev, ...next }));
      })
      .catch(() => {
        // A body that will not load costs the join button, not the meeting.
        // Let the day be retried rather than leaving it permanently blank.
        loaded.current.delete(day);
      });
    return () => {
      live = false;
    };
  }, [day]);

  return bodies;
}
