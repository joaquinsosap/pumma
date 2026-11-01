import { beforeEach, describe, expect, it, vi } from "vitest";

const toastError = vi.hoisted(() => vi.fn());
vi.mock("sonner", () => ({ toast: { error: toastError } }));

import { redirect } from "next/navigation";
import { trySave } from "@/lib/try-save";

beforeEach(() => toastError.mockClear());

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
    expect(onFail).toHaveBeenCalledOnce();
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
    );
    expect(onFail).toHaveBeenCalledOnce();
  });

  it("lets a redirect through, so a lapsed session reaches the login page", async () => {
    const onFail = vi.fn();
    await expect(
      trySave(async () => redirect("/login"), onFail),
    ).rejects.toThrow("NEXT_REDIRECT");
    expect(toastError).not.toHaveBeenCalled();
    expect(onFail).not.toHaveBeenCalled();
  });
});
