import { describe, it, expect } from "vitest";
import {
  autoTaskTitle,
  noteTitleFromBody,
  parseOmni,
  taskTitleEnd,
  tokenizeOmniInput,
} from "@/lib/parse";

describe("noteTitleFromBody", () => {
  it("takes the first eight words", () => {
    expect(
      noteTitleFromBody("call the plumber about the leak in the kitchen sink"),
    ).toBe("call the plumber about the leak in the…");
  });

  it("takes all of a short note, with nothing to signal", () => {
    expect(noteTitleFromBody("groceries for sunday")).toBe(
      "groceries for sunday",
    );
    // Exactly eight is not truncated, so it gets no ellipsis.
    expect(noteTitleFromBody("one two three four five six seven eight")).toBe(
      "one two three four five six seven eight",
    );
  });

  it("stops at the end of the first line", () => {
    expect(noteTitleFromBody("Shopping list\nmilk\neggs\nbread")).toBe(
      "Shopping list",
    );
  });

  it("drops punctuation left dangling by the cut", () => {
    expect(
      noteTitleFromBody("ask about the roof, the gutters, and the drains"),
    ).toBe("ask about the roof, the gutters, and the…");
  });

  it("clips a line with no spaces in it", () => {
    const title = noteTitleFromBody("x".repeat(200));
    expect(title).toBe("x".repeat(72) + "…");
  });

  it("has nothing to offer for an empty note", () => {
    expect(noteTitleFromBody("")).toBe("");
    expect(noteTitleFromBody("   \n  ")).toBe("");
  });
});

describe("autoTaskTitle", () => {
  const long = "call the plumber about the leak in the kitchen sink";

  it("gives a long task its opening words as the title and keeps the whole text", () => {
    expect(autoTaskTitle(long, "")).toEqual({
      title: "call the plumber about the leak in the…",
      description: long,
    });
  });

  it("leaves a short task alone", () => {
    expect(autoTaskTitle("groceries for sunday", "")).toEqual({
      title: "groceries for sunday",
      description: "",
    });
    const eight = "one two three four five six seven eight";
    expect(autoTaskTitle(eight, "")).toEqual({ title: eight, description: "" });
  });

  it("lets a colon's description win", () => {
    expect(autoTaskTitle(long, "before friday")).toEqual({
      title: long,
      description: "before friday",
    });
  });

  it("clips a wall of text with no spaces at 72 characters", () => {
    const wall = "x".repeat(90);
    expect(autoTaskTitle(wall, "")).toEqual({
      title: `${"x".repeat(72)}…`,
      description: wall,
    });
  });
});

describe("taskTitleEnd", () => {
  const ref = new Date(2026, 9, 29);
  // What stays bright: the stored title, and any lifted date or tag before the description starts.
  const kept = (text: string) => {
    const parsed = parseOmni(text, [], ref);
    const end = taskTitleEnd(text, parsed);
    return end === null ? null : text.slice(0, end).trimEnd();
  };

  it("lands after the eighth word, past the tag and date the parser lifted out", () => {
    expect(
      kept(
        "call the #home plumber tomorrow about the leak in the kitchen sink",
      ),
    ).toBe("call the #home plumber tomorrow about the leak in the");
  });

  it("keeps up when a lifted date or tag sat next to punctuation", () => {
    expect(
      kept(
        "Call mom tomorrow, then book the flights and the hotel for the trip",
      ),
    ).toBe("Call mom tomorrow, then book the flights and the");
    expect(
      kept("fix login #bug, then deploy the new build to staging and prod"),
    ).toBe("fix login #bug, then deploy the new build to");
    expect(
      kept(
        "Prepare the slides (#work) for the board meeting with the investors",
      ),
    ).toBe("Prepare the slides (#work) for the board meeting with");
  });

  it("follows the stored split when only tokens come after a colon", () => {
    expect(
      kept(
        "Write the quarterly report for the finance team and send it: #work",
      ),
    ).toBe("Write the quarterly report for the finance team");
    expect(
      kept("#bug: the login page is broken on mobile after the latest deploy"),
    ).toBe("#bug: the login page is broken on mobile after");
  });

  it("keeps up with a date the parser lifts by position, not by its first copy", () => {
    expect(
      kept(
        "Call the bank next  friday about the mortgage refinance paperwork and the fees",
      ),
    ).toBe("Call the bank next  friday about the mortgage refinance paperwork");
    expect(
      kept(
        "#march-release prep the notes, then ship it early march with the team and QA",
      ),
    ).toBe("#march-release prep the notes, then ship it early march");
  });

  it("leaves a date between the title and its colon bright", () => {
    expect(
      kept("Dentist friday 9:00: bring the insurance card and the forms"),
    ).toBe("Dentist friday 9:00");
  });

  it("keeps an ellipsis typed into the title", () => {
    expect(kept("Wait for it…: then go")).toBe("Wait for it…");
  });

  it("ends at the colon of a title: description capture", () => {
    expect(kept("Pay rent: transfer to the landlord")).toBe("Pay rent");
  });

  it("is null when the task keeps no description", () => {
    expect(kept("groceries for sunday")).toBe(null);
    expect(kept("Pay rent: #work")).toBe(null);
  });

  it("can end partway through a word the 72-character clip cut", () => {
    const wall = "x".repeat(90);
    expect(kept(wall)).toBe("x".repeat(72));
  });
});

describe("tokenizeOmniInput dimFrom", () => {
  it("dims only the plain text past the cut", () => {
    const tokens = tokenizeOmniInput("one two #web three four", [], {
      dimFrom: 18,
    });
    expect(
      tokens.map((t) => [t.text, t.kind === "text" && Boolean(t.dim)]),
    ).toEqual([
      ["one two ", false],
      ["#web", false],
      [" three", false],
      [" four", true],
    ]);
  });

  it("replaces the raw colon rule when given, so null dims nothing", () => {
    const tokens = tokenizeOmniInput("send it: #work", [], { dimFrom: null });
    expect(tokens.some((t) => t.kind === "text" && t.dim)).toBe(false);
  });

  it("falls back to the raw colon rule when not given", () => {
    const tokens = tokenizeOmniInput("title: one two", []);
    expect(
      tokens.map((t) => [t.text, t.kind === "text" && Boolean(t.dim)]),
    ).toEqual([
      ["title", false],
      [": one two", true],
    ]);
  });
});

describe("parseOmni title", () => {
  const ref = new Date(2026, 9, 29);

  it("loses the date it heard even when it was typed with two spaces", () => {
    expect(
      parseOmni("Call the bank next  friday about the mortgage", [], ref).title,
    ).toBe("Call the bank about the mortgage");
  });

  it("never cuts a date word out of a longer word", () => {
    expect(parseOmni("todays plan, then ship it today", [], ref).title).toBe(
      "todays plan, then ship it",
    );
  });

  it("takes the punctuation a lifted date or tag would strand", () => {
    const title = (text: string) => parseOmni(text, [], ref).title;
    expect(title("Call mom tomorrow, then book the flights")).toBe(
      "Call mom, then book the flights",
    );
    expect(title("Prepare the slides (#work) for the board")).toBe(
      "Prepare the slides for the board",
    );
    expect(title("Review the deck (with #design) and ship")).toBe(
      "Review the deck (with) and ship",
    );
    expect(title("#bug: the login page is broken")).toBe(
      "the login page is broken",
    );
    expect(title("Write the report and send it: #work")).toBe(
      "Write the report and send it",
    );
    expect(title("Buy milk, tomorrow, and eggs")).toBe("Buy milk, and eggs");
    expect(title("call mom tomorrow!")).toBe("call mom!");
  });

  it("leaves punctuation alone when nothing was lifted beside it", () => {
    expect(parseOmni("Ship it! #work", [], ref).title).toBe("Ship it!");
    expect(parseOmni("a :b", [], ref)).toMatchObject({
      title: "a",
      description: "b",
    });
  });

  it("still splits at a colon a lifted date sat before", () => {
    expect(
      parseOmni("Pay rent tomorrow: transfer to the landlord", [], ref),
    ).toMatchObject({
      title: "Pay rent",
      description: "transfer to the landlord",
    });
  });
});
