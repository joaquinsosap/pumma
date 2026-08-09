import { describe, it, expect } from "vitest";
import { completeOmniToken, cycleTypeAtCaret } from "@/lib/omni-complete";
import { RESERVED_TYPE, RESERVED_TYPE_WORDS } from "@/lib/omni-reserved";

const T = RESERVED_TYPE_WORDS;
const at = (text: string) => cycleTypeAtCaret(text, text.length, T);

describe("stepping the type at the caret", () => {
  it("swaps a finished type for the next one", () => {
    expect(at("Ship it #task")?.text).toBe("Ship it #habit");
    expect(at("Ship it #habit")?.text).toBe("Ship it #goal");
    expect(at("Ship it #goal")?.text).toBe("Ship it #note");
  });

  it("wraps round rather than stopping at the end", () => {
    expect(at("Ship it #note")?.text).toBe("Ship it #task");
  });

  it("goes backwards for shift-Tab", () => {
    const text = "Ship it #task";
    expect(cycleTypeAtCaret(text, text.length, T, -1)?.text).toBe(
      "Ship it #note",
    );
  });

  it("starts at the first type from a bare #", () => {
    expect(at("Ship it #")?.text).toBe("Ship it #task");
  });

  it("leaves the caret after the word, ready for another press", () => {
    const done = at("Ship it #task")!;
    expect(done.text.slice(0, done.caret)).toBe("Ship it #habit");
  });

  it("never adds a trailing space — the cycle has to stay open", () => {
    // A settled completion gets a space so typing carries on in prose. This
    // is the opposite case: you are meant to be able to press Tab again.
    expect(at("Ship it #task")?.text.endsWith("#habit")).toBe(true);
    expect(at("Ship it #task")?.exact).toBe(false);
  });

  it("keeps whatever follows the token", () => {
    const text = "Ship it #task #work";
    // Caret sits at the end of "#task", not at the end of the line.
    expect(cycleTypeAtCaret(text, 13, T)?.text).toBe("Ship it #habit #work");
  });
});

describe("a token that just settled", () => {
  it("reopens through the trailing space completion left", () => {
    // "#ta" + Tab writes "#task " — the space puts the token beyond
    // tokenAtCaret, and Tab again would otherwise be a dead key.
    expect(at("Ship it #task ")?.text).toBe("Ship it #habit ");
    expect(at("Ship it #habit ")?.text).toBe("Ship it #goal ");
  });

  it("keeps the space and the caret after it", () => {
    const done = at("Ship it #task ")!;
    expect(done.text).toBe("Ship it #habit ");
    expect(done.caret).toBe(done.text.length);
  });

  it("only reopens types, never a settled tag", () => {
    expect(at("Ship it #work ")).toBeNull();
  });

  it("does not reach back past text written since", () => {
    expect(at("Ship it #task and then some")).toBeNull();
  });
});

describe("what it refuses", () => {
  it("ignores a half-typed word, so completion gets first refusal", () => {
    expect(at("Ship it #ta")).toBeNull();
    expect(at("Ship it #hab")).toBeNull();
  });

  it("ignores ordinary tags", () => {
    expect(at("Ship it #work")).toBeNull();
    expect(at("Ship it #mytag")).toBeNull();
  });

  it("ignores the priority prefix, which has its own words", () => {
    expect(at("Ship it !hi")).toBeNull();
  });

  it("ignores text with no token at the caret at all", () => {
    expect(at("Ship it")).toBeNull();
    expect(at("")).toBeNull();
  });
});

describe("why it has to run before completion", () => {
  it("completion alone would settle #task instead of moving on", () => {
    // One candidate means "finished": a space is appended and the cycle ends.
    // That is correct for a tag and useless for a type, which is the whole
    // reason cycleTypeAtCaret is tried first.
    const done = completeOmniToken("Ship it #task", 13, [...T]);
    expect(done?.exact).toBe(true);
    expect(done?.text).toBe("Ship it #task ");
  });
});

describe("the word list", () => {
  it("covers exactly the types the parser recognises", () => {
    expect([...T].sort()).toEqual(Object.keys(RESERVED_TYPE).sort());
  });
});
