"use client";

// The furniture around the stage: the mission banner up top and the checklist
// down the side. Both exist so the tour never leaves you wondering what it
// wants or how much is left — the two things that make a walkthrough feel
// like a hostage situation.
import { Check, Hand, X } from "@/components/icons";
import type { Beat } from "@/lib/tutorial";
import { cn } from "@/lib/utils";

export function MissionBanner({
  beat,
  index,
  total,
  cleared,
  instruction,
}: {
  beat: Beat;
  index: number;
  total: number;
  cleared: boolean;
  /** The step's actual ask. It gets the big type — "Type u" is what you need
   *  to read, and it was being whispered under a caption that never changed
   *  while the thing being asked for did. */
  instruction?: string;
}) {
  const isMission = beat.kind === "do";
  return (
    <div
      key={beat.id}
      className="tutorial-in mx-auto w-full max-w-[620px] text-center"
    >
      <div className="mb-2 flex items-center justify-center gap-2">
        <span
          className={cn(
            "rounded-full px-2.5 py-0.5 font-mono text-[9.5px] font-bold uppercase tracking-[0.16em]",
            isMission
              ? "bg-primary text-background"
              : "border border-white/25 text-white/60",
          )}
        >
          {isMission ? `Mission ${index + 1}/${total}` : "Watch"}
        </span>
        {isMission && !cleared && (
          <span className="font-mono text-[9.5px] uppercase tracking-[0.16em] text-white/60">
            your turn
          </span>
        )}
      </div>

      {/* The ask, in the biggest type on screen. The theme sits under it —
          it's why the step exists, not what to do about it.

          Both lines live in boxes of a fixed height. The text under them
          changes on nearly every keystroke, and a block that resizes itself
          drags the whole scene up and down the screen while you are trying to
          type into it. Reserving the room costs a little whitespace on the
          short lines and buys a stage that never moves. */}
      <div className="flex min-h-[70px] items-center justify-center sm:min-h-[96px]">
        <p
          className="m-0 text-[28px] font-black leading-[1.06] tracking-tight text-white sm:text-[40px]"
          /* A dark halo under white type: the stage behind it is a blurred
             screenshot, and white-on-whatever-is-behind-it was the one thing
             making the biggest line on screen hard to read. */
          style={{
            textShadow:
              "0 2px 18px rgba(0,0,0,0.75), 0 1px 3px rgba(0,0,0,0.55)",
          }}
        >
          {cleared && beat.done
            ? `✓ ${beat.done}`
            : (instruction ?? beat.caption)}
        </p>
      </div>

      <div className="mt-1 flex min-h-[42px] items-start justify-center">
        <p
          className={cn(
            "m-0 leading-relaxed transition-colors",
            cleared
              ? // The payoff line was mid-green on a dark backdrop and barely
                // legible — the one line you actually want read.
                "text-[16px] font-bold text-[oklch(0.86_0.17_152)]"
              : "text-[14.5px] font-medium text-white/80",
          )}
        >
          {instruction ? beat.caption : beat.sub}
        </p>
      </div>
    </div>
  );
}

export function TutorialChecklist({
  beats,
  index,
  className,
}: {
  beats: Beat[];
  index: number;
  className?: string;
}) {
  return (
    <ol
      className={cn(
        "m-0 flex list-none flex-col gap-1 rounded-xl border border-white/10 bg-white/[0.06] p-2 backdrop-blur-sm",
        className,
      )}
    >
      {beats.map((b, i) => {
        const done = i < index;
        const now = i === index;
        return (
          <li
            key={b.id}
            className={cn(
              "flex items-center gap-2 rounded-lg px-2 py-1.5 transition-colors",
              now && "bg-white/10",
            )}
          >
            <span
              className={cn(
                "flex h-4 w-4 shrink-0 items-center justify-center rounded-[5px] border transition-colors",
                done
                  ? "border-habits bg-habits"
                  : now
                    ? "border-white/70"
                    : "border-white/25",
              )}
            >
              {done && (
                <Check className="h-2.5 w-2.5 text-white" strokeWidth={4} />
              )}
              {now && <span className="h-1.5 w-1.5 rounded-full bg-white" />}
            </span>
            <span
              className={cn(
                "font-mono text-[10.5px] uppercase tracking-wider transition-colors",
                done
                  ? "text-white/45 line-through"
                  : now
                    ? "font-bold text-white"
                    : "text-white/40",
              )}
            >
              {b.step}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/**
 * Live feedback on the capture mission's three tokens. Telling someone their
 * input is wrong is useless; showing them which of the three parts is still
 * missing is a game.
 */
export function TokenChecks({
  checks,
}: {
  checks: { label: string; ok: boolean }[];
}) {
  return (
    <div className="mt-3 flex flex-wrap items-center gap-1.5">
      {checks.map((c) => (
        <span
          key={c.label}
          className={cn(
            "flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-mono text-[10px] transition-all",
            c.ok
              ? "border-habits bg-habits/10 font-semibold text-habits"
              : "border-border bg-surface2 text-faint2",
          )}
        >
          <span
            className={cn(
              "flex h-3 w-3 items-center justify-center rounded-full border",
              c.ok ? "border-habits bg-habits" : "border-faint2",
            )}
          >
            {c.ok && <Check className="h-2 w-2 text-white" strokeWidth={5} />}
          </span>
          {c.label}
        </span>
      ))}
    </div>
  );
}

/**
 * Offered when someone has been on one beat for a while AND the keyboard has
 * been getting nowhere. The tour can't be skipped, which is funny for two
 * clicks and cruel after twenty seconds of being genuinely stuck — so it opens
 * the door itself, takes the joke rather than giving it, and says where to
 * find the thing again.
 */
export function FlounderCard({
  onLeave,
  onStay,
}: {
  onLeave: () => void;
  onStay: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[220] flex items-center justify-center bg-black/50 px-4 backdrop-blur-sm">
      <div className="tutorial-in w-full max-w-[400px] rounded-[20px] border-2 border-ink bg-surface p-6 shadow-[0_1px_2px_var(--shadow),0_24px_60px_-12px_var(--shadow)]">
        <span className="text-[28px]">🕯️</span>
        <h2 className="m-0 mt-2 text-[19px] font-extrabold leading-tight tracking-tight text-ink">
          Not the brightest candle in the drawer.
        </h2>
        {/* Borrowed from the loudest man alive, because a four-beat tutorial
            defeating you is exactly the sort of small suffering he means. */}
        <blockquote className="m-0 mt-3 border-l-2 border-ink/20 pl-3">
          <p className="m-0 text-[12.5px] font-semibold italic leading-relaxed text-ink">
            &ldquo;When you think that you are done, you&rsquo;re only 40% in to
            what your body&rsquo;s capable of doing.&rdquo;
          </p>
          <p className="m-0 mt-0.5 font-mono text-[10px] text-faint">
            — David Goggins, about something harder than this
          </p>
        </blockquote>

        <p className="m-0 mt-2.5 font-mono text-[10.5px] leading-relaxed text-faint">
          It lives in Settings → Tour if you change your mind.
        </p>

        <div className="mt-5 grid grid-cols-2 gap-2.5">
          <button
            type="button"
            onClick={onStay}
            className="rounded-xl border-2 border-border px-3 py-3 text-[13px] font-bold leading-tight text-muted transition-colors hover:border-faint hover:text-ink"
          >
            I&apos;m dumb but hard{" "}
            <span className="font-mono text-[10px] font-semibold text-faint">
              (continue)
            </span>
          </button>
          <button
            type="button"
            onClick={onLeave}
            className="flex items-center justify-center gap-2 rounded-xl bg-ink px-3 py-3 text-[13px] font-bold text-background transition-opacity hover:opacity-90"
          >
            <Hand className="h-4 w-4" />
            Give up
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * The way out, once it's been offered and turned down. Someone who said "I've
 * got this" and then changed their mind shouldn't have to get stuck a second
 * time to be asked again.
 */
export function QuitButton({ onQuit }: { onQuit: () => void }) {
  return (
    <button
      type="button"
      onClick={onQuit}
      aria-label="Leave the tour"
      title="Leave the tour"
      className="absolute right-4 top-6 z-10 flex h-9 w-9 items-center justify-center rounded-full border border-white/20 text-white/50 transition-colors hover:border-white/50 hover:text-white"
    >
      <X className="h-4 w-4" />
    </button>
  );
}
