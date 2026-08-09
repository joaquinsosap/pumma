"use client";

// The projector. Watch beats run on a clock; missions wait for the user and
// have no clock at all — which is why progress is counted in beats rather than
// seconds. The tour can't be skipped once it starts; that's the joke the intro
// card sets up, and it's short enough to be one.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  BEATS,
  flounderLimit,
  isFloundering,
  progressAt,
} from "@/lib/tutorial";
import { markTutorialSeen } from "@/lib/actions/settings";
import { setTutorialActive } from "@/lib/tutorial-lock";
import { onTutorialReplay } from "@/lib/tutorial-replay";
import { stallLimitMs, startTutorialClock } from "@/lib/tutorial-clock";
import { TutorialIntro } from "@/components/tutorial/TutorialIntro";
import {
  FlounderCard,
  MissionBanner,
  QuitButton,
  TutorialChecklist,
} from "@/components/tutorial/TutorialChrome";
import {
  SceneAssistant,
  SceneBulk,
  SceneBulkWatch,
  SceneLife,
  SceneTab,
  SceneTabTouch,
  SceneTag,
  SceneType,
} from "@/components/tutorial/TutorialScenes";
import { cn } from "@/lib/utils";

/**
 * How long a cleared mission holds before moving on.
 *
 * It used to be 1.4s, which was fine when the payoff was a line of text you
 * could read in one go. Now the card plays the thing landing where it lives,
 * and 1.4s meant the pop was still finishing as the scene was swapped out:
 * you saw a flicker of something and then the next beat. Long enough to
 * watch, short enough not to sit through.
 */
const CLEARED_HOLD_MS = 2800;
/** The closing sweep — long enough to read as a transition, short enough not
 *  to be a thing you sit through. */
const OUTRO_MS = 900;

export function TutorialOverlay({ seen }: { seen: boolean }) {
  const router = useRouter();
  // Read once, on mount. `seen` flips to true the instant the tour starts —
  // it is written then so that abandoning it still counts — and re-reading it
  // on every render would close the tour on its own first frame.
  const [hidden, setHidden] = useState(seen);
  const [playing, setPlaying] = useState(false);
  const [finished, setFinished] = useState(false);
  const [index, setIndex] = useState(0);
  const [cleared, setCleared] = useState(false);
  const [outro, setOutro] = useState(false);
  const [floundering, setFloundering] = useState(false);
  const [dismissedFlounder, setDismissedFlounder] = useState(false);
  /** The step's own ask, for the banner. Scenes know it; beats don't. */
  const [instruction, setInstruction] = useState<string | undefined>();
  /** Watch beats only: 0–1 through the current scene. */
  const [p, setP] = useState(0);

  // …but a replay from Settings has to get through. That flips `seen` back to
  // false, and it is the one direction worth reacting to: the other direction
  // is the tour recording itself as it starts, which must not close it.
  //
  // Without this, "Play the tour again" navigated home and nothing happened —
  // the overlay was already mounted on the settings page with the old value,
  // and only a full reload gave it a new one.
  const rearm = useCallback(() => {
    setHidden(false);
    setFinished(false);
    setPlaying(false);
    setIndex(0);
    setCleared(false);
    setOutro(false);
  }, []);

  // The button says so directly, without waiting for the server to agree.
  useEffect(() => onTutorialReplay(rearm), [rearm]);

  useEffect(() => {
    if (seen) return;
    setHidden(false);
    setFinished(false);
    setPlaying(false);
    setIndex(0);
    setCleared(false);
    setOutro(false);
  }, [seen]);

  // ⌘ and shift are the whole point of one mission, and neither exists on a
  // touch screen — so there it plays instead of being asked for.
  const canModifierClick = useMemo(
    () =>
      typeof window !== "undefined" &&
      window.matchMedia?.("(pointer: fine)").matches !== false,
    [],
  );

  const beat = BEATS[index];
  // ⌘, shift and Tab are the point of two of these beats, and none of them
  // exist on a touch screen: there, the bulk beat plays itself and the Tab
  // beat becomes the type pills it maps to.
  const isMission =
    beat.kind === "do" &&
    (["bulk", "tab"].includes(beat.id) ? canModifierClick : true);

  const advance = useCallback(() => {
    setIndex((i) => {
      if (i + 1 >= BEATS.length) return i;
      return i + 1;
    });
    setCleared(false);
    setP(0);
  }, []);

  // Leaving is a sweep of light across the screen, not a disappearance: the
  // overlay is the size of the window, and something that size vanishing
  // between two frames reads as a glitch rather than an ending.
  const finish = useCallback(() => {
    setOutro(true);
    void markTutorialSeen();
    // (the start already recorded it — this just moves the timestamp to the
    // moment it actually ended)
    window.setTimeout(() => {
      setFinished(true);
      router.refresh();
    }, OUTRO_MS);
  }, [router]);

  /** A mission reports itself done; hold on the payoff, then move on. */
  const onDone = useCallback(() => {
    setCleared(true);
    window.setTimeout(() => {
      if (index + 1 >= BEATS.length) finish();
      else advance();
    }, CLEARED_HOLD_MS);
  }, [index, advance, finish]);

  // The clock, for watch beats only.
  //
  // It runs on real time while the page is visible and pauses outright while
  // it isn't: switch tabs mid-beat and you come back to where you left off
  // rather than to a scene that has already played to an empty room.
  //
  // The stall limit is the backstop for hosts that call a page hidden while
  // someone is looking straight at it — without it the tour simply stops, and
  // a watch beat is not a mission, so nothing else would ever offer a way out.
  useEffect(() => {
    if (!playing || finished || isMission) return;
    const ms = beat.ms ?? 9_000;
    let elapsed = 0;
    let stop = () => {};
    const done = () => {
      stop();
      window.clearTimeout(stall);
      setP(1);
      if (index + 1 >= BEATS.length) finish();
      else advance();
    };
    // A timer rather than a check inside the clock: the clock is exactly what
    // stops running in the case this exists to survive.
    const stall = window.setTimeout(done, stallLimitMs(ms));
    stop = startTutorialClock((dt) => {
      elapsed += dt;
      if (elapsed >= ms) return done();
      setP(elapsed / ms);
    });
    return () => {
      stop();
      window.clearTimeout(stall);
    };
  }, [playing, finished, isMission, beat.ms, index, advance, finish]);

  // Has this beat been open a while, with the keyboard getting nowhere?
  // Counted per beat and reset by progress, so a slow reader is never accused
  // of anything — only someone who is both stuck and busy.
  const beatOpenedAt = useRef(performance.now());
  const strayKeys = useRef(0);
  useEffect(() => {
    beatOpenedAt.current = performance.now();
    strayKeys.current = 0;
    setFloundering(false);
    // Belt and braces: a beat whose scene forgets to report an ask should
    // fall back to its own caption rather than shouting the last one's.
    setInstruction(undefined);
  }, [index]);

  // Progress within a beat counts too: a seven-step mission shouldn't accuse
  // someone of being stuck while they're moving through it.
  const noteProgress = useCallback(() => {
    beatOpenedAt.current = performance.now();
    strayKeys.current = 0;
  }, []);

  const noteStray = useCallback(() => {
    strayKeys.current += 1;
  }, []);

  const takeInstruction = useCallback(
    (next: string) => {
      setInstruction(next);
      noteProgress();
    },
    [noteProgress],
  );

  useEffect(() => {
    if (!playing || finished || dismissedFlounder || !isMission) return;
    const id = window.setInterval(() => {
      if (
        isFloundering(
          performance.now() - beatOpenedAt.current,
          strayKeys.current,
          flounderLimit(beat.id),
        )
      ) {
        setFloundering(true);
      }
    }, 1000);
    return () => window.clearInterval(id);
  }, [playing, finished, dismissedFlounder, isMission, index, beat.id]);

  // A tour that scrolls out from under itself is worse than no tour.
  useEffect(() => {
    if (!playing || finished) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [playing, finished]);

  // Take the keyboard off the app underneath. The overlay stops pointers by
  // covering them; keys reach window listeners regardless of what's drawn on
  // top, and the capture bar has three of them.
  useEffect(() => {
    if (!playing || finished) return;
    setTutorialActive(true);
    return () => setTutorialActive(false);
  }, [playing, finished]);

  // The input gate. Each beat declares the keys it wants and everything else
  // is swallowed, so there is exactly one thing to do at any moment and no way
  // to wander off and break the scene. Browser combos (⌘R, ⌘L, F5) are left
  // alone deliberately — trapping someone in a tab is a different and much
  // worse thing than asking them to press Tab.
  useEffect(() => {
    if (!playing || finished) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const wantsTyping = beat.id === "type";
      const wantsTab = beat.id === "tab" && isMission;
      if (e.key === "Tab") {
        // Never let Tab walk the focus ring into the app underneath, whether
        // or not this beat is the one about Tab.
        e.preventDefault();
        if (!wantsTab) strayKeys.current += 1;
        return;
      }
      if (wantsTyping) return;
      // Anything else, on a beat not listening for it: swallowed, and noted.
      // Enough of these is what opens the door out.
      if (e.key.length === 1 || e.key === "Enter" || e.key === "Backspace") {
        e.preventDefault();
        strayKeys.current += 1;
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [playing, finished, beat.id, isMission]);

  if (hidden || finished) return null;
  if (!playing)
    return (
      <TutorialIntro
        onStart={() => {
          setPlaying(true);
          // Recorded on START, not only on finish. The only ways it used to be
          // written were reaching the outro, "Give up", or the ✕ — so anyone
          // who began the tour and then reloaded, navigated away or closed the
          // tab was greeted by it all over again next time, for ever. Whether
          // they saw it through is not the question the flag answers; "has this
          // account been shown the tour" is.
          void markTutorialSeen();
        }}
      />
    );

  // The badge counts each kind against its own total — "3 of 6" is no use when
  // four of the six want something from you and two do not. Scoped to the kind
  // a beat ACTUALLY plays as: on touch two missions become watch beats, so a
  // count taken off `beat.kind` would promise gestures the device can't make.
  const playsAsMission = (b: (typeof BEATS)[number]) =>
    b.kind === "do" &&
    (["bulk", "tab"].includes(b.id) ? canModifierClick : true);
  const sameKind = (b: (typeof BEATS)[number]) =>
    playsAsMission(b) === isMission;
  const kindTotal = BEATS.filter(sameKind).length;
  const kindIndex = BEATS.slice(0, index + 1).filter(sameKind).length;

  return (
    <div
      className={cn(
        "fixed inset-0 z-[200] flex flex-col bg-black/70 backdrop-blur-[3px]",
        outro && "tutorial-outro",
      )}
    >
      {outro && (
        <span
          className="tutorial-sweep pointer-events-none absolute inset-0"
          aria-hidden
        />
      )}
      <div className="h-[3px] w-full shrink-0 bg-white/15">
        <div
          className="h-full bg-primary transition-[width] duration-500"
          style={{ width: `${progressAt(index + (cleared ? 1 : 0)) * 100}%` }}
        />
      </div>

      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-5 px-4 py-4">
        <MissionBanner
          beat={{ ...beat, kind: isMission ? "do" : "watch" }}
          kindIndex={kindIndex}
          kindTotal={kindTotal}
          cleared={cleared}
          instruction={isMission ? instruction : undefined}
        />

        <div key={beat.id} className="tutorial-in flex w-full justify-center">
          <Scene
            id={beat.id}
            p={p}
            done={cleared}
            onDone={onDone}
            asMission={isMission}
            onInstruction={takeInstruction}
            onStray={noteStray}
            onProgress={noteProgress}
          />
        </div>
      </div>

      {/* Desktop: down the left, out of the way. Phone: a strip along the
          bottom, where there's width to spare and no height. */}
      <TutorialChecklist
        beats={BEATS}
        index={index}
        className="pointer-events-none absolute left-5 top-1/2 hidden -translate-y-1/2 lg:flex"
      />
      <div className="shrink-0 px-4 pb-4 lg:hidden">
        <TutorialChecklist
          beats={BEATS}
          index={index}
          className="pointer-events-none mx-auto max-w-[560px] flex-row justify-between overflow-x-auto"
        />
      </div>

      {/* Offered once and turned down: from then on the door stays visible
          rather than making someone get stuck again to be asked twice. */}
      {dismissedFlounder && !outro && <QuitButton onQuit={finish} />}

      {floundering && !outro && (
        <FlounderCard
          onLeave={finish}
          onStay={() => {
            setFloundering(false);
            setDismissedFlounder(true);
            noteProgress();
            // The card had focus; without this you'd have to click the field
            // before you could type again.
            window.setTimeout(() => {
              const field =
                document.querySelector<HTMLInputElement>(".z-\\[200\\] input");
              field?.focus();
            }, 60);
          }}
        />
      )}
    </div>
  );
}

function Scene({
  id,
  p,
  done,
  onDone,
  asMission,
  onInstruction,
  onStray,
  onProgress,
}: {
  id: (typeof BEATS)[number]["id"];
  p: number;
  done: boolean;
  onDone: () => void;
  asMission: boolean;
  onInstruction: (text: string) => void;
  onStray: () => void;
  onProgress: () => void;
}) {
  const shared = { onDone, done, onInstruction, onStray, onProgress };
  switch (id) {
    case "type":
      return <SceneType {...shared} />;
    case "tab":
      // No Tab key on a phone: the beat becomes the pills it maps to.
      return asMission ? (
        <SceneTab {...shared} />
      ) : (
        <SceneTabTouch {...shared} />
      );
    case "tag":
      return <SceneTag {...shared} />;
    case "bulk":
      return asMission ? <SceneBulk {...shared} /> : <SceneBulkWatch p={p} />;
    case "ask":
      return <SceneAssistant p={p} half="ask" />;
    case "request":
      return <SceneAssistant p={p} half="request" />;
    case "life":
      return <SceneLife p={p} />;
  }
}
