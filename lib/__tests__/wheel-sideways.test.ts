import { describe, expect, it } from "vitest";
import { glides, sidewaysTarget, type Strip, type WheelTurn } from "@/lib/wheel-sideways";

const strip: Strip = { from: 0, max: 764, page: 740 };
const notch: WheelTurn = { deltaX: 0, deltaY: 100, deltaMode: 0 };

describe("a wheel over a sideways strip", () => {
  it("moves the strip sideways by what the wheel turned", () => {
    expect(sidewaysTarget(notch, strip)).toBe(100);
    expect(sidewaysTarget({ ...notch, deltaY: -60 }, { ...strip, from: 200 })).toBe(140);
  });

  it("adds a second notch to where the strip was already heading", () => {
    const first = sidewaysTarget(notch, strip)!;
    expect(sidewaysTarget(notch, { ...strip, from: first })).toBe(200);
  });

  it("stops at either end", () => {
    expect(sidewaysTarget({ ...notch, deltaY: 900 }, { ...strip, from: 700 })).toBe(764);
    expect(sidewaysTarget({ ...notch, deltaY: -900 }, { ...strip, from: 50 })).toBe(0);
  });

  it("gives the wheel back to the page once the strip is at its end that way", () => {
    expect(sidewaysTarget(notch, { ...strip, from: 764 })).toBeNull();
    expect(sidewaysTarget({ ...notch, deltaY: -100 }, strip)).toBeNull();
  });

  it("counts a fraction short of the end as the end, as a zoomed page leaves it", () => {
    expect(sidewaysTarget(notch, { ...strip, from: 763.6 })).toBeNull();
    expect(sidewaysTarget({ ...notch, deltaY: -100 }, { ...strip, from: 0.4 })).toBeNull();
  });

  it("leaves a strip with nothing hidden alone", () => {
    expect(sidewaysTarget(notch, { from: 0, max: 0, page: 740 })).toBeNull();
  });

  it("leaves a turn that is already sideways to the browser", () => {
    expect(sidewaysTarget({ deltaX: 80, deltaY: 10, deltaMode: 0 }, strip)).toBeNull();
    expect(sidewaysTarget({ deltaX: 40, deltaY: 40, deltaMode: 0 }, strip)).toBeNull();
  });

  it("leaves zoom and the browser's own shift wheel alone", () => {
    expect(sidewaysTarget({ ...notch, ctrlKey: true }, strip)).toBeNull();
    expect(sidewaysTarget({ ...notch, shiftKey: true }, strip)).toBeNull();
  });

  it("reads a turn counted in lines or pages as pixels", () => {
    expect(sidewaysTarget({ deltaX: 0, deltaY: 3, deltaMode: 1 }, strip)).toBe(120);
    expect(sidewaysTarget({ deltaX: 0, deltaY: 1, deltaMode: 2 }, strip)).toBe(740);
  });
});

describe("how the strip gets there", () => {
  it("glides for a wheel's notch and follows the fingers for a trackpad's small moves", () => {
    expect(glides(100)).toBe(true);
    expect(glides(-120)).toBe(true);
    expect(glides(4)).toBe(false);
    expect(glides(-30)).toBe(false);
  });
});
