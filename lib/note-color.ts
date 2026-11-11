import { PROJECT_COLOR_NAMES, PROJECT_COLORS } from "@/lib/project-colors";

/** The colours a note can wear: the same six a project picks from. */
export const NOTE_COLORS: readonly string[] = PROJECT_COLORS;

/** What a pick may be saved as: one of the palette, null for no colour, or undefined when it is neither. */
export function noteColorPick(value: unknown): string | null | undefined {
  if (value === null) return null;
  return typeof value === "string" && NOTE_COLORS.includes(value)
    ? value
    : undefined;
}

/** A palette colour's plain name, for a swatch's label. */
export function noteColorName(color: string): string {
  return (PROJECT_COLOR_NAMES as Record<string, string>)[color] ?? "this color";
}
