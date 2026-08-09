/**
 * A clock for scenes that play themselves.
 *
 * The naive version — count frames, cap the delta so a tab switch can't skip
 * the whole beat — has a nasty failure mode: a hidden page still gets the odd
 * frame, and each one credits at most the cap. A nine-second beat then takes
 * a minute and a half, and if frames stop altogether it never finishes at all.
 * Someone comes back to a tour that has quietly hung.
 *
 * So: real time while the page is visible, a genuine pause while it isn't.
 * Nothing is missed and nothing crawls.
 */
export function startTutorialClock(
  step: (dtMs: number) => void,
  /**
   * Whether time stops while the page is hidden.
   *
   * True for anything that plays itself — a scene shouldn't perform to nobody.
   * False for anything the user is actively holding down: they can't be
   * pressing a key on a page they aren't looking at, so freezing buys nothing,
   * and it costs everything on a host that reports a visible page as hidden.
   * Either way the resync below means returning to a tab never lurches.
   */
  pauseWhenHidden = true,
): () => void {
  let last = performance.now();
  let raf = 0;

  // Coming back after a spell hidden, the gap since the last frame is not
  // elapsed beat time — it's the time we deliberately weren't counting.
  const resync = () => {
    last = performance.now();
  };

  const tick = (now: number) => {
    const dt = pauseWhenHidden && document.hidden ? 0 : now - last;
    last = now;
    if (dt > 0) step(dt);
    raf = requestAnimationFrame(tick);
  };

  document.addEventListener("visibilitychange", resync);
  raf = requestAnimationFrame(tick);

  return () => {
    cancelAnimationFrame(raf);
    document.removeEventListener("visibilitychange", resync);
  };
}

/**
 * How long a beat is allowed to take in wall-clock terms before it gives up
 * and moves on regardless.
 *
 * The pause above trusts `document.hidden`, and some hosts — an embedded
 * preview pane, a background render — report a page as hidden while someone
 * is plainly looking at it. Trusting that forever means a tour that never
 * advances, which is the one outcome worse than a beat playing to an empty
 * room. Generous enough that a real reader never trips it.
 */
export function stallLimitMs(beatMs: number): number {
  return beatMs * 4 + 15_000;
}
