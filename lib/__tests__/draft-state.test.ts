import { describe, expect, it } from "vitest";
import {
  committedRequired,
  draftFrom,
  fromServer,
  reverted,
  send,
  sendFailed,
  typed,
  type DraftState,
} from "@/lib/draft-state";

/** Sends what is waiting and returns the state after, failing the test if nothing was waiting. */
function sent(state: DraftState): DraftState {
  const out = send(state);
  if (!out) throw new Error("nothing to send");
  return out.state;
}

describe("text from the server", () => {
  it("shows in the box and is never sent back", () => {
    const state = fromServer(draftFrom("old"), "newer, from a chat");
    expect(state.shown).toBe("newer, from a chat");
    expect(send(state)).toBeNull();
  });

  it("is not sent even after many pages", () => {
    let state = draftFrom("one");
    for (const value of ["two", "three", "four"]) {
      state = fromServer(state, value);
      expect(send(state)).toBeNull();
    }
    expect(state.shown).toBe("four");
  });
});

describe("typing", () => {
  it("sends exactly what was typed, once", () => {
    const state = typed(draftFrom("old"), "mine");
    const out = send(state)!;
    expect(out.value).toBe("mine");
    expect(send(out.state)).toBeNull();
  });

  it("has nothing to send when typed back to what is stored", () => {
    const state = typed(typed(draftFrom("old"), "oldx"), "old");
    expect(state.shown).toBe("old");
    expect(send(state)).toBeNull();
  });

  it("compares with what was last sent, not with a page still on its way", () => {
    const afterSend = sent(typed(draftFrom("old"), "first"));
    // Typed back to the original while the first save is out: that has to go too.
    const back = typed(afterSend, "old");
    expect(send(back)?.value).toBe("old");
    // Typed back to what just went out: nothing new to say.
    expect(send(typed(typed(afterSend, "firstx"), "first"))).toBeNull();
  });
});

describe("a fresh value while typing", () => {
  it("keeps the words on screen", () => {
    const state = fromServer(typed(draftFrom("old"), "mine"), "theirs");
    expect(state.shown).toBe("mine");
    expect(state.unsaved).toBe(true);
    expect(send(state)?.value).toBe("mine");
  });

  it("has nothing left to save when both say the same", () => {
    const state = fromServer(typed(draftFrom("old"), "same"), "same");
    expect(state.shown).toBe("same");
    expect(send(state)).toBeNull();
  });
});

describe("our own page coming back", () => {
  it("doesn't move the box, even while more is being typed", () => {
    const out = sent(typed(draftFrom("old"), "abc"));
    const more = typed(out, "abcd");
    const state = fromServer(more, "abc");
    expect(state.shown).toBe("abcd");
    expect(send(state)?.value).toBe("abcd");
  });

  it("can't take the box back when an older one lands after a newer save", () => {
    const first = sent(typed(draftFrom("old"), "abc"));
    const second = sent(typed(first, "abcd"));
    const older = fromServer(second, "abc");
    expect(older.shown).toBe("abcd");
    expect(send(older)).toBeNull();
    const newer = fromServer(older, "abcd");
    expect(newer.shown).toBe("abcd");
    expect(newer.sent).toEqual([]);
  });

  it("doesn't eat a trailing space when the server trims it", () => {
    const out = sent(typed(draftFrom("old"), "my note "));
    const state = fromServer(out, "my note");
    expect(state.shown).toBe("my note ");
    expect(send(state)).toBeNull();
  });

  it("forgets what it sent once a newer value came from elsewhere", () => {
    const out = sent(typed(draftFrom("old"), "abc"));
    const theirs = fromServer(out, "theirs");
    expect(theirs.shown).toBe("theirs");
    // Our save landed after theirs, so this page is the truth and it shows.
    expect(fromServer(theirs, "abc").shown).toBe("abc");
  });
});

describe("a failed save", () => {
  it("keeps the words and sends them again next time", () => {
    const out = send(typed(draftFrom("old"), "mine"))!;
    const state = sendFailed(out.state, out.value);
    expect(state.shown).toBe("mine");
    expect(state.sent).toEqual([]);
    expect(send(state)?.value).toBe("mine");
  });

  it("doesn't resend when something newer already went out", () => {
    const first = send(typed(draftFrom("old"), "abc"))!;
    const second = sent(typed(first.state, "abcd"));
    const state = sendFailed(second, first.value);
    expect(state.sent).toEqual(["abcd"]);
    expect(send(state)).toBeNull();
  });

  it("keeps newer typing and sends that", () => {
    const first = send(typed(draftFrom("old"), "abc"))!;
    const state = sendFailed(typed(first.state, "abcd"), first.value);
    expect(state.shown).toBe("abcd");
    expect(send(state)?.value).toBe("abcd");
  });

  it("doesn't bring old words back over someone else's text", () => {
    const first = send(typed(draftFrom("old"), "abc"))!;
    const theirs = fromServer(first.state, "theirs");
    const state = sendFailed(theirs, first.value);
    expect(state.shown).toBe("theirs");
    expect(send(state)).toBeNull();
  });

  it("still sends after the box is typed back to the old text, since nobody knows what is stored", () => {
    const first = send(typed(draftFrom("old"), "abc"))!;
    const state = typed(sendFailed(first.state, first.value), "old");
    expect(send(state)?.value).toBe("old");
  });
});

describe("cancelling", () => {
  it("goes back to what is stored and sends nothing", () => {
    const state = reverted(typed(draftFrom("old"), "typed"));
    expect(state.shown).toBe("old");
    expect(send(state)).toBeNull();
  });

  it("goes back to the newest stored value", () => {
    const state = reverted(fromServer(typed(draftFrom("old"), "typed"), "theirs"));
    expect(state.shown).toBe("theirs");
    expect(send(state)).toBeNull();
  });

  it("goes back to what the server last said after a failed save", () => {
    const first = send(typed(draftFrom("old"), "abc"))!;
    const state = reverted(sendFailed(first.state, first.value));
    expect(state.shown).toBe("old");
  });
});

describe("leaving a box that can't be blank", () => {
  it("leaves untouched text alone", () => {
    const state = draftFrom("Title");
    expect(committedRequired(state)).toBe(state);
  });

  it("goes back to what is stored when blank, and sends nothing", () => {
    for (const blank of ["", "   "]) {
      const state = committedRequired(typed(draftFrom("Title"), blank));
      expect(state.shown).toBe("Title");
      expect(send(state)).toBeNull();
    }
  });

  it("sends the trimmed text", () => {
    const state = committedRequired(typed(draftFrom("Title"), "  New  "));
    expect(state.shown).toBe("New");
    expect(send(state)?.value).toBe("New");
  });

  it("has nothing to send when only spaces were added", () => {
    const state = committedRequired(typed(draftFrom("Title"), " Title "));
    expect(state.shown).toBe("Title");
    expect(send(state)).toBeNull();
  });

  it("goes back to what the server last said when a save failed and the box is blank", () => {
    const first = send(typed(draftFrom("Title"), "New"))!;
    const failed = sendFailed(first.state, first.value);
    expect(committedRequired(typed(failed, "")).shown).toBe("Title");
  });
});
