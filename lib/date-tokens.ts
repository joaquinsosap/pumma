// Dates you can type with a "#", the same way you type a tag.
//
// The bar used to read "friday" out of plain prose with chrono. That works,
// but it makes the date the one token you have to write differently from
// everything else: "#work" is a command, "#high" is a command, and then
// "friday" is… a word you hope is understood. Putting dates behind the same
// prefix means one rule for the whole bar — "#" is how you tell it something"
// — and it makes them completable, which a bare word can never be.
//
// Pure functions, no DOM and no clock of their own: the caller passes the
// reference date, so the tests can pin "next friday" to an actual Friday.

/** How a numeric date is read when the parts are ambiguous. */
export type DateOrder = "dmy" | "mdy";

export const WEEKDAYS: Record<string, number> = {
  sun: 0,
  sunday: 0,
  mon: 1,
  monday: 1,
  tue: 2,
  tues: 2,
  tuesday: 2,
  wed: 3,
  weds: 3,
  wednesday: 3,
  thu: 4,
  thur: 4,
  thurs: 4,
  thursday: 4,
  fri: 5,
  friday: 5,
  sat: 6,
  saturday: 6,
};

/** The relative words, in the order the completion menu should offer them. */
export const RELATIVE_DAYS = ["today", "tomorrow", "yesterday"] as const;

/**
 * What Tab offers you.
 *
 * Long names only. The short forms are still typeable and still resolve — they
 * are just not separate candidates, because a pool holding both "fri" and
 * "friday" can never settle: "fri" matches two things, so completion rotates
 * between two spellings of the same day and Tab appears to be broken.
 */
export const DATE_COMPLETIONS: string[] = [
  ...RELATIVE_DAYS,
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
];

/**
 * Every date word the bar answers to. Wider than the completion list: this is
 * what "is this a date?" and "could this still become one?" ask, so it has to
 * know the abbreviations people actually type.
 */
export const DATE_WORDS: string[] = [
  ...DATE_COMPLETIONS,
  "mon",
  "tue",
  "tues",
  "wed",
  "weds",
  "thu",
  "thur",
  "thurs",
  "fri",
  "sat",
  "sun",
];

const pad = (n: number) => String(n).padStart(2, "0");
const isoOf = (d: Date) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

const TITLE = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * A numeric date: 4/8, 04-08, 4/8/26, 4.8.2026.
 *
 * Separator is whichever of / - . you reached for. A two-digit year is this
 * century — someone capturing a task is not filing a 1926 deadline.
 */
function parseNumeric(
  word: string,
  ref: Date,
  order: DateOrder,
): { date: string; label: string } | null {
  const m = word.match(/^(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2}|\d{4}))?$/);
  if (!m) return null;

  const a = Number(m[1]);
  const b = Number(m[2]);
  let day: number;
  let month: number;
  if (order === "mdy") {
    month = a;
    day = b;
  } else {
    day = a;
    month = b;
  }
  // A month above 12 can only have been meant the other way round — read it
  // that way rather than refusing a date the person clearly typed correctly.
  if (month > 12 && day <= 12) [day, month] = [month, day];
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;

  let year: number;
  if (m[3]) {
    year = Number(m[3]);
    if (m[3].length === 2) year += 2000;
  } else {
    // No year given: the next time this day comes round, so "#25/12" in
    // January is this year's Christmas and in December is next year's.
    year = ref.getFullYear();
    const candidate = new Date(year, month - 1, day);
    if (isoOf(candidate) < isoOf(ref)) year += 1;
  }

  const date = new Date(year, month - 1, day);
  // Rejects the 31st of a 30-day month rather than silently rolling over.
  if (date.getMonth() !== month - 1 || date.getDate() !== day) return null;
  return { date: isoOf(date), label: `${pad(day)}/${pad(month)}` };
}

/**
 * Resolve one "#word" to a due date, or null if it isn't a date at all.
 *
 * Weekdays look forward: on a Tuesday, "#friday" is this week's and "#monday"
 * is next week's. Naming the day you are already on means a week's time —
 * "#tuesday" on a Tuesday is not a way of saying today, which is what "#today"
 * is for.
 */
export function resolveDateToken(
  word: string,
  ref: Date,
  order: DateOrder = "dmy",
): { date: string; label: string } | null {
  const w = word.trim().toLowerCase();
  if (!w) return null;

  const base = new Date(ref.getFullYear(), ref.getMonth(), ref.getDate());

  if (w === "today") return { date: isoOf(base), label: "Today" };
  if (w === "tomorrow") {
    base.setDate(base.getDate() + 1);
    return { date: isoOf(base), label: "Tomorrow" };
  }
  if (w === "yesterday") {
    base.setDate(base.getDate() - 1);
    return { date: isoOf(base), label: "Yesterday" };
  }

  const target = WEEKDAYS[w];
  if (target !== undefined) {
    const delta = (target - base.getDay() + 7) % 7 || 7;
    base.setDate(base.getDate() + delta);
    const full = Object.keys(WEEKDAYS).find(
      (k) => WEEKDAYS[k] === target && k.length > 3,
    )!;
    return { date: isoOf(base), label: TITLE(full) };
  }

  return parseNumeric(w, base, order);
}

/** Whether "#word" would be read as a date — used to keep it out of tag names. */
export function isDateToken(word: string, order: DateOrder = "dmy"): boolean {
  return resolveDateToken(word, new Date(2026, 0, 1), order) !== null;
}
