// Shared input-validation primitives for server actions. Every action validates
// its input with these before touching the data layer — ids must be well-formed
// (closes NoSQL-injection-shaped inputs arriving via the action wire format) and
// free-text fields are length-capped (protects storage and page payloads).
import { z } from "zod";
import { isReservedTagName } from "@/lib/omni-reserved";

/** 24-char hex id — matches oid() in lib/date.ts and Mongo ObjectId strings. */
export const entityId = z.string().regex(/^[0-9a-f]{24}$/, "Invalid id");

export const title = z.string().trim().min(1, "Required").max(200, "Too long");
export const shortText = z.string().trim().max(500, "Too long");
export const noteBody = z.string().max(50_000, "Too long");
/**
 * Tag names, minus the words the capture bar claims for itself.
 *
 * A tag called "high" or "note" would be swallowed by the parser every time it
 * was typed, so it's refused at the door rather than left to fail confusingly
 * later. This is the single chokepoint — creating and renaming both use it.
 */
export const tagName = z
  .string()
  .trim()
  .min(1, "Required")
  .max(40, "Too long")
  .refine((name) => !isReservedTagName(name), {
    message: "That word is reserved by the capture bar",
  });

/** "YYYY-MM-DD" (optionally with a time suffix, e.g. task due "2026-06-28T14:00"). */
export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Invalid date");
export const isoDateTime = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2})?)?$/, "Invalid date");

/** Prompt/question text for the AI actions. */
export const aiInput = z
  .string()
  .trim()
  .min(3, "Too short")
  .max(2_000, "Too long");

/** CSS color as used by the app's palettes (oklch(...), #hex, or var(--token)). */
export const cssColor = z
  .string()
  .trim()
  .max(64)
  .regex(
    /^(oklch\([^)]*\)|#[0-9a-fA-F]{3,8}|var\(--[\w-]+\))$/,
    "Invalid color",
  );
