// Which pages carry a "New ..." button, and that it never names a kind the bar there would not pick itself.
import { describe, expect, it } from "vitest";
import {
  captureButtonFor,
  capturePlaceholder,
  getCaptureContext,
} from "@/lib/capture-context";

describe("captureButtonFor", () => {
  it.each([
    ["/", "task"],
    ["/tasks", "task"],
    ["/projects", "project"],
    ["/calendar", "task"],
    ["/notes", "note"],
    ["/notes/a1b2", "note"],
    ["/notes/", "note"],
    ["/habits", "habit"],
    ["/goals", "goal"],
  ])("on %s makes a %s", (path, kind) => {
    expect(captureButtonFor(path)).toBe(kind);
  });

  it.each(["/settings", "/assistant", "/life", "/billing"])(
    "has no button on %s, which is not a place to add from",
    (path) => {
      expect(captureButtonFor(path)).toBeNull();
    },
  );

  it("is not fooled by a path that only starts like a page", () => {
    expect(captureButtonFor("/notesy")).toBeNull();
    expect(captureButtonFor("/tasks-archive")).toBeNull();
  });

  it("names the kind the bar already picks on that page", () => {
    // The default capture is set to something else on purpose: on these pages the page decides, not the setting.
    for (const path of ["/", "/tasks", "/projects", "/calendar", "/notes", "/habits", "/goals"]) {
      const bar = getCaptureContext(path, new URLSearchParams(), path === "/notes" ? "task" : "note");
      // A project is made by the bar while it is set to tasks, so that is the kind it has to agree with.
      const button = captureButtonFor(path);
      expect({ path, kind: button === "project" ? "task" : button }).toEqual({ path, kind: bar.type });
    }
  });

  it("is absent exactly where the bar falls back to the default capture", () => {
    // A button that named a kind there would disagree with the setting half the time.
    for (const path of ["/settings", "/assistant", "/life"]) {
      expect(getCaptureContext(path, new URLSearchParams(), "note").type).toBe("note");
      expect(captureButtonFor(path)).toBeNull();
    }
  });
});

describe("capturePlaceholder", () => {
  const home = getCaptureContext("/", new URLSearchParams(), "task");

  it("keeps the page's own words while the bar makes what the page makes", () => {
    const board = getCaptureContext(
      "/projects",
      new URLSearchParams("project=p1"),
      "task",
      [{ id: "p1", title: "Website redesign" }],
    );
    expect(capturePlaceholder(board, "task")).toContain("Add to Website redesign");
    expect(capturePlaceholder(home, "task")).toBe(home.placeholder);
  });

  it.each([
    ["habit", "New habit"],
    ["goal", "New goal"],
    ["note", "New note"],
  ] as const)("asks for a %s once the bar is switched to one", (kind, words) => {
    const said = capturePlaceholder(home, kind);
    expect(said).toContain(words);
    expect(said).not.toContain("task");
  });

  it("keeps the side of life a goals page names", () => {
    const work = getCaptureContext("/goals", new URLSearchParams("life=work"), "task");
    expect(capturePlaceholder(work, "goal")).toContain("New work goal");
    expect(capturePlaceholder(work, "habit")).toContain("New habit");
  });

  it("asks for a task again on a page that makes something else", () => {
    const notes = getCaptureContext("/notes", new URLSearchParams(), "task");
    expect(capturePlaceholder(notes, "note")).toBe(notes.placeholder);
    expect(capturePlaceholder(notes, "task")).toContain("Capture a task");
  });
});
