// The looks behind the bulb.
//
// A look is a whole-app colouring: the ground, the cards, the text, the
// buttons. Mist is the glassy one PUMMA shipped with; the rest are matte,
// flat and solid, in plain families (greys, beige, a blue). The colours
// themselves live in globals.css, one block per look; this file is the list
// and the two rules the rest of the app needs from it.

export const LOOKS = [
  { id: "mist", name: "Mist", mode: "light", finish: "glass", ground: "#eef2f6", card: "#fbfcfd", button: "#3170c8" },
  { id: "fog", name: "Fog", mode: "light", finish: "matte", ground: "#e4e4e2", card: "#f6f6f4", button: "#1f1f1f" },
  { id: "linen", name: "Linen", mode: "light", finish: "matte", ground: "#e3d8c5", card: "#f3ecdf", button: "#4a3722" },
  { id: "graphite", name: "Graphite", mode: "dark", finish: "matte", ground: "#26272a", card: "#313236", button: "#e4e5e7" },
  { id: "onyx", name: "Onyx", mode: "dark", finish: "matte", ground: "#0c0c0d", card: "#161617", button: "#f0f0f0" },
  { id: "navy", name: "Navy", mode: "dark", finish: "matte", ground: "#0b1423", card: "#121e33", button: "#8fbdf7" },
] as const;

export type Look = (typeof LOOKS)[number];
export type LookId = Look["id"];

export const LOOK_IDS = LOOKS.map((l) => l.id) as [LookId, ...LookId[]];

export function lookById(id: LookId): Look {
  return LOOKS.find((l) => l.id === id) ?? LOOKS[0];
}

/**
 * The look an account sees: the one it picked, or the nearest to the light
 * and dark switch there was before looks. Dark lands on Graphite, the plain
 * dark grey: the old dark is not one of the looks.
 */
export function lookFor(
  settings: { look?: string | null; theme?: string | null } | null,
): Look {
  const picked = LOOKS.find((l) => l.id === settings?.look);
  if (picked) return picked;
  return lookById(settings?.theme === "dark" ? "graphite" : "mist");
}

/**
 * A stored colour (a tag's, a project's, a calendar's) as the look in front
 * paints it.
 *
 * Those colours are picked once and have to read on every look, so a look
 * leans them toward its text colour by however much its grounds need: darker
 * on a light look, lighter on a dark one, the hue kept. Mist leans them by
 * nothing, so there this is the colour itself. `alpha` is for the tints and
 * soft edges drawn from the same colour.
 *
 * Only for colours a person picks. Section colours, the capture types and the
 * life calendar's moods are PUMMA's own: each look carries or keeps those.
 *
 * A plain colour mix on purpose: it is what the stylesheet already relies on
 * everywhere, where the newer relative-colour syntax drops the whole
 * declaration in browsers a couple of years old.
 */
export function paint(color: string, alpha?: number): string {
  const held = `color-mix(in oklab, ${color} var(--pick-keep), var(--pick-to))`;
  if (alpha === undefined) return held;
  return `color-mix(in oklab, ${held} ${Math.round(alpha * 100)}%, transparent)`;
}
