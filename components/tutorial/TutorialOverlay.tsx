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
import { ChevronRight } from "@/components/icons";
import { setTutorialActive } from "@/lib/tutorial-lock";
import { readTourOverride } from "@/lib/tutorial-dev";
import { useVisualViewport } from "@/lib/use-visual-viewport";
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
  SceneBulkTouch,
  SceneLife,
  SceneSync,
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
  // `?tour=sync` in development opens the tour on that beat. Compiled out of
  // production entirely — see lib/tutorial-dev for why that is safe.
  const devTour = useRef<ReturnType<typeof readTourOverride>>(null);
  // The capture beat puts a real field on screen, so on a phone a real
  // keyboard comes up over it, and an overlay sized to the WINDOW centres
  // itself behind that keyboard.
  //
  // Measured as the visible box rather than as "window minus keyboard". The
  // subtraction version was tried and shipped, and on iOS it over-reserved by
  // about a hundred pixels, because the number it subtracts also contains
  // Safari's own bottom bar and the accessory strip. That is what made the
  // bottom of the tour drift and its contents get cut. Matching the visible
  // box needs no theory about what is covering the rest.
  const viewport = useVisualViewport();
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

  // Development only, and only once: jump straight to the beat being worked
  // on, skipping the intro and every mission before it.
  useEffect(() => {
    if (devTour.current) return;
    const override = readTourOverride();
    if (!override) return;
    devTour.current = override;
    setHidden(false);
    setFinished(false);
    setCleared(false);
    setOutro(false);
    setIndex(override.index);
    setPlaying(true);
  }, []);

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

  // The beats this device can actually do.
  //
  // Tab is a key, and a phone has no keys. The beat already had a touch
  // stand-in, but the copy around it still said "press Tab until the bar says
  // goal", and a tour that asks for something the hardware cannot do is worse
  // than a tour that skips it. On touch it is dropped outright, and every
  // count, checklist and index below reads from this list rather than from
  // the full script, so they all agree about how long the tour is.
  const beats = useMemo(
    () => (canModifierClick ? BEATS : BEATS.filter((b) => b.id !== "tab")),
    [canModifierClick],
  );

  const beat = beats[index] ?? beats[beats.length - 1];
  // ⌘ and shift are the point of the bulk beat and neither exists on a touch
  // screen, so there it plays itself instead of being asked for. (The Tab
  // beat is not in `beats` at all on touch — see above.)
  // Only Tab still needs a keyboard. The bulk beat has a real gesture on a
  // phone — long-press, then "Select through" — so it is a mission there too
  // rather than a scene that plays itself at you.
  const isMission =
    beat.kind === "do" && (beat.id === "tab" ? canModifierClick : true);

  const advance = useCallback(() => {
    setIndex((i) => {
      if (i + 1 >= beats.length) return i;
      return i + 1;
    });
    setCleared(false);
    setP(0);
  }, [beats.length]);

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
      if (index + 1 >= beats.length) finish();
      else advance();
    }, CLEARED_HOLD_MS);
  }, [index, advance, finish, beats.length]);

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
      if (index + 1 >= beats.length) finish();
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
  }, [
    playing,
    finished,
    isMission,
    beat.ms,
    index,
    advance,
    finish,
    beats.length,
  ]);

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
    b.kind === "do" && (b.id === "tab" ? canModifierClick : true);
  const sameKind = (b: (typeof BEATS)[number]) =>
    playsAsMission(b) === isMission;
  const kindTotal = beats.filter(sameKind).length;
  const kindIndex = beats.slice(0, index + 1).filter(sameKind).length;

  return (
    <div
      className={cn(
        "fixed inset-0 z-[200] flex flex-col bg-black/70 backdrop-blur-[3px]",
        outro && "tutorial-outro",
      )}
      // The overlay BECOMES the visible box rather than covering the window
      // and padding the difference. `inset-0` still applies when there is no
      // keyboard, so nothing changes on a desktop.
      //
      // The stage is also told to be smaller while the keyboard is up: a
      // fixed 430px stage plus a 175px banner does not fit in what a phone
      // has left. The floor stops it collapsing on a short screen; below that
      // the scene would rather clip than vanish.
      style={
        viewport?.keyboardOpen
          ? ({
              top: viewport.top,
              height: viewport.height,
              bottom: "auto",
              "--stage-h": `${Math.max(190, viewport.height - 270)}px`,
            } as React.CSSProperties)
          : beat.stage
            ? ({ "--stage-h": `${beat.stage}px` } as React.CSSProperties)
            : undefined
      }
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
            touch={!canModifierClick}
            done={cleared}
            onDone={onDone}
            asMission={isMission}
            onInstruction={takeInstruction}
            onStray={noteStray}
            onProgress={noteProgress}
          />
        </div>
      </div>

      {/* Watch beats get a way out.
          A scene that plays itself is a scene you are stuck in front of, and
          the honest fix is not to make them shorter but to let the viewer
          leave. The button doubles as the clock: it fills as the beat runs,
          so the wait is visible rather than indefinite, and pressing it early
          is the same as reaching the end. */}
      {!isMission && !outro && !cleared && (
        <div className="-mt-2 flex shrink-0 justify-center px-4">
          <button
            type="button"
            onClick={() => {
              if (index + 1 >= beats.length) finish();
              else advance();
            }}
            // The app's own control, not a glass pill. bg-surface hands the
            // face, rim and contact shadow to globals.css, which owns all
            // three with !important — so this deliberately does NOT try to
            // state a border or a shadow of its own. Same recipe as every
            // other small button in PUMMA, which is the point: the previous
            // translucent capsule was the only thing on screen that came
            // from nowhere else in the app.
            //
            // (It also must not carry pumma-floating: that forces
            // background-color from --floating with !important, which is
            // white on the light theme, and white text on it made the label
            // disappear entirely.)
            className="relative flex h-9 items-center gap-2 overflow-hidden rounded-lg border border-border bg-surface px-4 font-mono text-[11px] font-bold uppercase tracking-[0.14em] text-ink transition-colors"
          >
            {/* The fill sits behind the label and is the same value the
                beat's own clock reports, so it can never disagree with when
                the scene actually ends. */}
            <span
              aria-hidden
              className="absolute inset-y-0 left-0 bg-primary/20"
              style={{ width: `${Math.round(p * 100)}%` }}
            />
            <span className="relative">
              {index + 1 >= beats.length ? "Finish" : "Next"}
            </span>
            <ChevronRight className="relative h-3 w-3" />
          </button>
        </div>
      )}

      {/* Desktop: down the left, out of the way. Phone: a strip along the
          bottom, where there's width to spare and no height. */}
      <TutorialChecklist
        beats={beats}
        index={index}
        className="pointer-events-none absolute left-5 top-1/2 hidden -translate-y-1/2 lg:flex"
      />
      <div className="shrink-0 px-4 pb-4 lg:hidden">
        <TutorialChecklist
          beats={beats}
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
  touch,
  done,
  onDone,
  asMission,
  onInstruction,
  onStray,
  onProgress,
}: {
  id: (typeof BEATS)[number]["id"];
  p: number;
  /** No keyboard and no pointer: the beats pick the gesture from this. */
  touch: boolean;
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
      // Same mission, the gesture each device actually has.
      return touch ? (
        <SceneBulkTouch {...shared} />
      ) : (
        <SceneBulk {...shared} />
      );
    case "sync":
      return <SceneSync p={p} />;
    case "ask":
      return <SceneAssistant p={p} half="ask" />;
    case "request":
      return <SceneAssistant p={p} half="request" />;
    case "life":
      return <SceneLife p={p} />;
  }
}
