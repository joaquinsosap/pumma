import { beforeEach, describe, expect, it, vi } from "vitest";

const toastError = vi.hoisted(() => vi.fn());
const catchUpNow = vi.hoisted(() => vi.fn());
vi.mock("sonner", () => ({ toast: { error: toastError } }));
vi.mock("@/lib/save-catch-up", () => ({ catchUpNow }));

import { redirect } from "next/navigation";
import { trySave } from "@/lib/try-save";

beforeEach(() => {
  toastError.mockClear();
  catchUpNow.mockClear();
});

describe("trySave", () => {
  it("hands back what the save answered, and says nothing", async () => {
    const onFail = vi.fn();
    const answer = { ok: true, data: 1 };
    expect(await trySave(async () => answer, onFail)).toBe(answer);
    expect(toastError).not.toHaveBeenCalled();
    expect(onFail).not.toHaveBeenCalled();
  });

  it("treats a save that answers nothing as done", async () => {
    const onFail = vi.fn();
    expect(await trySave(async () => undefined, onFail)).toBeUndefined();
    expect(onFail).not.toHaveBeenCalled();
  });

  it("shows the server's refusal, calls onFail and gives back null", async () => {
    const onFail = vi.fn();
    expect(
      await trySave(async () => ({ ok: false, error: "Name taken" }), onFail),
    ).toBeNull();
    expect(toastError).toHaveBeenCalledWith("Name taken");
    expect(onFail).toHaveBeenCalledExactlyOnceWith("refused");
  });

  it("says something even when the refusal has no words", async () => {
    await trySave(async () => ({ ok: false }));
    expect(toastError).toHaveBeenCalledWith("Could not save that.");
  });

  it("says a lost connection and calls onFail, instead of taking the page down", async () => {
    const onFail = vi.fn();
    expect(
      await trySave(async () => {
        throw new TypeError("Failed to fetch");
      }, onFail),
    ).toBeNull();
    expect(toastError).toHaveBeenCalledWith(
      "Could not save that. Check your connection.",
      expect.anything(),
    );
    expect(onFail).toHaveBeenCalledExactlyOnceWith("lost");
  });

  it("lets a redirect through, so a lapsed session reaches the login page", async () => {
    const onFail = vi.fn();
    await expect(
      trySave(async () => redirect("/login"), onFail),
    ).rejects.toThrow("NEXT_REDIRECT");
    expect(toastError).not.toHaveBeenCalled();
    expect(onFail).not.toHaveBeenCalled();
  });

  describe("catching up after the address moved", () => {
    it("asks before handing back, so the caller's transition is still open", async () => {
      const order: string[] = [];
      catchUpNow.mockImplementationOnce(() => order.push("catch up"));
      await trySave(async () => ({ ok: true })).then(() => order.push("back"));
      expect(order).toEqual(["catch up", "back"]);
    });

    it("asks after a refusal too, since the server answered", async () => {
      await trySave(async () => ({ ok: false, error: "No" }));
      expect(catchUpNow).toHaveBeenCalledOnce();
    });

    it("asks for nothing after a lost connection", async () => {
      await trySave(async () => {
        throw new TypeError("Failed to fetch");
      });
      expect(catchUpNow).not.toHaveBeenCalled();
    });
  });
});
