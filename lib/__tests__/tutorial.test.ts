import { describe, it, expect } from "vitest";
import {
  BEATS,
  checkCapture,
  FLOUNDER_KEYS,
  FLOUNDER_MS,
  flounderLimit,
  HOLD_MS,
  isFloundering,
  nextHold,
  progressAt,
  typedChars,
  watchMs,
} from "@/lib/tutorial";

describe("the cut", () => {
  it("gives every beat a caption short enough to read while it plays", () => {
    for (const beat of BEATS) {
      expect(beat.caption.length).toBeLessThanOrEqual(52);
      expect(beat.step.length).toBeLessThanOrEqual(12);
    }
  });

  it("has no duplicate ids — they key the scenes", () => {
    expect(new Set(BEATS.map((b) => b.id)).size).toBe(BEATS.length);
  });

  it("times every watch beat and no mission", () => {
    for (const beat of BEATS) {
      if (beat.kind === "watch") expect(beat.ms).toBeGreaterThan(0);
      else expect(beat.ms).toBeUndefined();
    }
  });

  it("gives every mission a line to show once it's cleared", () => {
    for (const beat of BEATS.filter((b) => b.kind === "do")) {
      expect(beat.done).toBeTruthy();
    }
  });

  it("is never mostly watching", () => {
    // Was "mostly doing", and held at 4 missions to 3 scenes. Adding the
    // calendar beat made it 4 and 4, which is a real change of character and
    // is recorded here rather than quietly relaxed: the tour may be half
    // watching, and must never tip past that. A fifth scene has to buy its
    // place by replacing one, not by weakening this line again.
    const missions = BEATS.filter((b) => b.kind === "do").length;
    expect(missions).toBeGreaterThanOrEqual(BEATS.length / 2);
  });

  it("keeps the self-playing part short — the rest is up to the user", () => {
    expect(watchMs() / 1000).toBeLessThanOrEqual(30);
  });
});

describe("progressAt", () => {
  it("runs from nothing to everything across the beats", () => {
    expect(progressAt(0)).toBe(0);
    expect(progressAt(BEATS.length)).toBe(1);
    expect(progressAt(3)).toBeCloseTo(3 / BEATS.length);
  });

  it("never reports more than done, however far it's pushed", () => {
    expect(progressAt(99)).toBe(1);
    expect(progressAt(-1)).toBe(0);
  });
});

describe("typedChars", () => {
  it("reveals the line as the beat plays", () => {
    expect(typedChars("hello", 0)).toBe("");
    expect(typedChars("hello", 1)).toBe("hello");
    expect(typedChars("hello", 0.5).length).toBe(3);
  });

  it("can be held to a window inside the beat, so the line lands early", () => {
    expect(typedChars("hello", 0.1, 0.2, 0.6)).toBe("");
    expect(typedChars("hello", 0.4, 0.2, 0.6)).toBe("hel");
    expect(typedChars("hello", 0.8, 0.2, 0.6)).toBe("hello");
  });
});

describe("the capture mission", () => {
  it("accepts the example it puts on screen", () => {
    expect(checkCapture("pay rent friday #finance").ok).toBe(true);
  });

  it("wants all three parts, not two of them", () => {
    expect(checkCapture("pay rent friday").ok).toBe(false);
    expect(checkCapture("pay rent #finance").ok).toBe(false);
    expect(checkCapture("friday #finance").ok).toBe(false);
  });

  it("says which part is missing, so the chips can show it", () => {
    const c = checkCapture("pay rent #finance");
    expect(c.hasTitle).toBe(true);
    expect(c.hasTag).toBe(true);
    expect(c.hasDay).toBe(false);
  });

  it("doesn't count the tokens themselves as the title", () => {
    // Tokens only: nothing is actually being captured.
    expect(checkCapture("friday #finance").hasTitle).toBe(false);
    expect(checkCapture("tomorrow #work !high").hasTitle).toBe(false);
  });

  it("takes any day word and any tag, not just the example's", () => {
    expect(checkCapture("call the bank tomorrow #admin").ok).toBe(true);
    expect(checkCapture("gym session mon #health").ok).toBe(true);
  });

  it("ignores case, the way the parser does", () => {
    expect(checkCapture("Pay Rent FRIDAY #Finance").ok).toBe(true);
  });

  it("wants a real tag, not a lone hash", () => {
    expect(checkCapture("pay rent friday #").hasTag).toBe(false);
    expect(checkCapture("pay rent friday #a").hasTag).toBe(false);
  });
});

describe("hold-to-confirm", () => {
  it("fills over the hold window while you stay on target", () => {
    let h = 0;
    h = nextHold(h, true, HOLD_MS / 2);
    expect(h).toBeCloseTo(0.5);
    h = nextHold(h, true, HOLD_MS / 2);
    expect(h).toBe(1);
  });

  it("drains faster than it fills, so overshooting costs you", () => {
    const gained = nextHold(0, true, 200);
    const lost = 0.5 - nextHold(0.5, false, 200);
    expect(lost).toBeGreaterThan(gained);
  });

  it("never goes below empty or above full", () => {
    expect(nextHold(0, false, 5_000)).toBe(0);
    expect(nextHold(1, true, 5_000)).toBe(1);
  });

  it("can't be mashed through: leaving and returning loses ground", () => {
    // 300ms on, 300ms off, repeated — a meter that crept up would let someone
    // Tab past the target over and over and still finish.
    let h = 0;
    for (let i = 0; i < 8; i++) {
      h = nextHold(h, true, 300);
      h = nextHold(h, false, 300);
    }
    expect(h).toBe(0);
  });
});

describe("knowing when to let someone go", () => {
  it("takes either signal on its own", () => {
    // Stuck and silent — the person most likely to need the way out.
    expect(isFloundering(FLOUNDER_MS, 0)).toBe(true);
    // Stuck and hammering keys the step never wanted.
    expect(isFloundering(0, FLOUNDER_KEYS)).toBe(true);
  });

  it("leaves someone alone while they're still getting on with it", () => {
    expect(isFloundering(FLOUNDER_MS - 1, FLOUNDER_KEYS - 1)).toBe(false);
  });

  it("gives the seven-step mission longer than the one-step ones", () => {
    expect(flounderLimit("type")).toBeGreaterThan(flounderLimit("tab"));
    // At the shorter limit, the long beat is still leaving you to it.
    expect(isFloundering(FLOUNDER_MS, 0, flounderLimit("type"))).toBe(false);
    expect(isFloundering(FLOUNDER_MS, 0, flounderLimit("tab"))).toBe(true);
  });

  it("uses the same limit for every beat that isn't the capture one", () => {
    for (const b of BEATS.filter((x) => x.id !== "type")) {
      expect(flounderLimit(b.id)).toBe(FLOUNDER_MS);
    }
  });
});
