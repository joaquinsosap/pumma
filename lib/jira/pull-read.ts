import "server-only";

import { createHash } from "node:crypto";

import { jiraIssueUrl } from "@/lib/jira/address";
import { jiraGet, jiraMyself, type JiraAnswer } from "@/lib/jira/client";
import { jiraFactsFrom, jiraUserIds } from "@/lib/jira/issue";
import type {
  PullForest,
  PulledEpic,
  PulledTicket,
} from "@/lib/jira/pull-plan";
import { ticketKeyFrom } from "@/lib/ticket-link";

// Reading what a pull would bring in: a COORD with its epics and their
// stories, one epic, one ticket, or everything assigned to the token's owner.
//
// Jira hangs work on two link fields rather than on `parent` (which only
// sub-tasks carry): a story names its epic in "Epic Link", an epic names the
// ticket above it in "Parent Link". Their ids differ from one Jira to the
// next, so they are looked up by what they are, never written down here.
//
// Every read is small on purpose. A pull is a handful of requests, each
// asking for named fields only, and none of it runs unless somebody asked.

type Raw = Record<string, unknown>;
const obj = (v: unknown): Raw | null =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Raw) : null;

export type JiraConn = { baseUrl: string; token: string };

/** The ids of the fields a pull reads on one Jira. Null when that Jira has no such field. */
export type LinkFields = {
  epicLink: string | null;
  parentLink: string | null;
  /** Only an epic has a value here, in any language, which is how an epic is told apart. */
  epicName: string | null;
};

/** What one pull reads with: that Jira's link fields, and what its token's owner is known by there. */
type Ids = LinkFields & {
  /** Empty when the owner is not known, and then no ticket is marked as theirs. */
  me: ReadonlySet<string>;
};

const EPIC_LINK_KIND = "com.pyxis.greenhopper.jira:gh-epic-link";
const EPIC_NAME_KIND = "com.pyxis.greenhopper.jira:gh-epic-label";
const PARENT_LINK_KIND = "com.atlassian.jpo:jpo-custom-field-parent";
const FIELD_ID = /^customfield_(\d{1,9})$/;

/**
 * The link fields out of Jira's list of fields. Found by the kind of field
 * first, which survives a rename, and by name only as a fallback.
 */
export function linkFieldsFrom(raw: unknown): LinkFields {
  const found: LinkFields = { epicLink: null, parentLink: null, epicName: null };
  if (!Array.isArray(raw)) return found;
  const fields = raw
    .map(obj)
    .filter((f): f is Raw => !!f && typeof f.id === "string" && FIELD_ID.test(f.id));
  const byKind = (kind: string) =>
    fields.find((f) => obj(f.schema)?.custom === kind)?.id as string | undefined;
  const byName = (name: string) =>
    fields.find(
      (f) => typeof f.name === "string" && f.name.trim().toLowerCase() === name,
    )?.id as string | undefined;
  found.epicLink = byKind(EPIC_LINK_KIND) ?? byName("epic link") ?? null;
  found.parentLink = byKind(PARENT_LINK_KIND) ?? byName("parent link") ?? null;
  found.epicName = byKind(EPIC_NAME_KIND) ?? byName("epic name") ?? null;
  return found;
}

/** A ticket's number out of a link field, whichever way that Jira writes it: the number itself, or an object holding it. */
export function keyIn(value: unknown): string | null {
  if (typeof value === "string") return ticketKeyFrom(value);
  const held = obj(value);
  if (!held) return null;
  return (
    ticketKeyFrom(held.key) ??
    ticketKeyFrom(obj(held.data)?.key) ??
    ticketKeyFrom(held.value)
  );
}

/** One ticket as read, with the tickets it names above itself. */
type Seen = {
  ticket: PulledTicket;
  isEpic: boolean;
  epicKey: string | null;
  parentKey: string | null;
  /** The story a sub-task belongs to. Null for anything that is not a sub-task. */
  subtaskOf: string | null;
};

/** Jira writes a moment as "2026-03-01T10:22:33.000+0000". Null for anything that is not one. */
export function momentFrom(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const at = new Date(v.replace(/([+-]\d{2})(\d{2})$/, "$1:$2"));
  return Number.isNaN(at.getTime()) ? null : at.toISOString();
}

function seenFrom(raw: unknown, base: string, ids: Ids): Seen | null {
  const facts = jiraFactsFrom(raw);
  if (!facts) return null;
  const fields = obj(obj(raw)?.fields) ?? {};
  const named = ids.epicName ? fields[ids.epicName] : null;
  return {
    ticket: {
      key: facts.key,
      title: facts.title ?? facts.key,
      stage: facts.stage,
      url: jiraIssueUrl(base, facts.key),
      mine: jiraUserIds(fields.assignee).some((id) => ids.me.has(id)),
      finished: momentFrom(fields.resolutiondate),
    },
    // The type's name covers a Jira with no epic name field; the field covers one in another language.
    isEpic: facts.type === "Epic" || (typeof named === "string" && named.trim() !== ""),
    epicKey: ids.epicLink ? keyIn(fields[ids.epicLink]) : null,
    parentKey: ids.parentLink ? keyIn(fields[ids.parentLink]) : null,
    subtaskOf: keyIn(fields.parent),
  };
}

type Failed = Extract<JiraAnswer<never>, { ok: false }>;
const NOT_JIRA: Failed = {
  ok: false,
  why: "not-jira",
  error: "That address answered, but not like a Jira.",
};

const PAGE = 50;
/** A search stops here and says so. A pull of several hundred tickets is not something to make tasks of in one go. */
const MAX_PAGES = 6;
/** Numbers per "key in (...)": one page holds them all, so a full group is one request. */
const KEYS_PER_SEARCH = PAGE;
/** Parents looked up for one pull. More than this hang loose, and the pull says there was more. */
const MAX_PARENTS = PAGE;
/** Tickets read one at a time when a search of several is refused over one of them. */
const ONE_BY_ONE = 15;

const fieldList = (ids: LinkFields) =>
  ["summary", "status", "issuetype", "assignee", "parent", "resolutiondate", ids.epicLink, ids.parentLink, ids.epicName]
    .filter(Boolean)
    .join(",");

/** `cf[10101]`, JQL's way to name a custom field by its id. */
const cf = (id: string) => `cf[${FIELD_ID.exec(id)![1]}]`;

// Fields rarely change. Asking once per Jira every ten minutes saves a request on every pull.
const FIELDS_FOR = new Map<string, { at: number; ids: LinkFields }>();
const FIELDS_FRESH_MS = 10 * 60 * 1000;
const FIELDS_KEPT = 50;

async function linkFields(conn: JiraConn): Promise<JiraAnswer<LinkFields>> {
  const hit = FIELDS_FOR.get(conn.baseUrl);
  if (hit && Date.now() - hit.at < FIELDS_FRESH_MS) {
    return { ok: true, data: hit.ids };
  }
  FIELDS_FOR.delete(conn.baseUrl);
  const res = await jiraGet(conn.baseUrl, conn.token, "/rest/api/2/field");
  if (!res.ok) return res;
  if (!Array.isArray(res.data)) return NOT_JIRA;
  const ids = linkFieldsFrom(res.data);
  // An answer with neither link in it is not worth remembering: it may be a
  // token that sees too little, and the next one deserves a fresh look.
  if (ids.epicLink || ids.parentLink) {
    if (FIELDS_FOR.size >= FIELDS_KEPT) FIELDS_FOR.clear();
    FIELDS_FOR.set(conn.baseUrl, { at: Date.now(), ids });
  }
  return { ok: true, data: ids };
}

// Whose token it is, kept as long as the fields are. The token is part of the
// key, as a short digest: another token on the same Jira is another person.
const OWNER_FOR = new Map<string, { at: number; me: ReadonlySet<string> | null }>();
const NOBODY: ReadonlySet<string> = new Set();
/** A Jira that would not say is asked again after this long, not on every pull. */
const OWNER_RETRY_MS = 60 * 1000;

/**
 * What the token's owner is known by on this Jira, or null when Jira would
 * not say. A pull goes on without it: it only loses the "assigned to me" mark.
 */
async function owner(conn: JiraConn): Promise<ReadonlySet<string> | null> {
  const key = `${conn.baseUrl}|${createHash("sha256").update(conn.token).digest("hex").slice(0, 12)}`;
  const hit = OWNER_FOR.get(key);
  if (hit && Date.now() - hit.at < (hit.me ? FIELDS_FRESH_MS : OWNER_RETRY_MS)) {
    return hit.me;
  }
  OWNER_FOR.delete(key);
  const res = await jiraMyself(conn.baseUrl, conn.token);
  const me = res.ok && res.data.ids.length > 0 ? new Set(res.data.ids) : null;
  if (OWNER_FOR.size >= FIELDS_KEPT) OWNER_FOR.clear();
  OWNER_FOR.set(key, { at: Date.now(), me });
  return me;
}

/** Forget what was learned about every Jira: its fields, and whose token it is. For tests, and for a connection that changed. */
export function forgetLinkFields(): void {
  FIELDS_FOR.clear();
  OWNER_FOR.clear();
}

type Found = { seen: Seen[]; capped: boolean };

async function search(
  conn: JiraConn,
  ids: Ids,
  jql: string,
  maxPages = MAX_PAGES,
): Promise<JiraAnswer<Found>> {
  const seen: Seen[] = [];
  for (let page = 0; page < maxPages; page++) {
    const res = await jiraGet(
      conn.baseUrl,
      conn.token,
      // validateQuery=false: a number in the search that this token cannot see is skipped, not a reason to refuse the lot.
      `/rest/api/2/search?jql=${encodeURIComponent(jql)}&fields=${fieldList(ids)}&startAt=${page * PAGE}&maxResults=${PAGE}&validateQuery=false`,
    );
    if (!res.ok) return res;
    const body = obj(res.data);
    if (!body || !Array.isArray(body.issues)) return NOT_JIRA;
    for (const raw of body.issues) {
      const one = seenFrom(raw, conn.baseUrl, ids);
      if (one) seen.push(one);
    }
    // No total given: a full page means there may be another.
    const more =
      typeof body.total === "number"
        ? (page + 1) * PAGE < body.total
        : body.issues.length === PAGE;
    if (body.issues.length === 0 || !more) {
      return { ok: true, data: { seen, capped: false } };
    }
  }
  return { ok: true, data: { seen, capped: true } };
}

async function one(
  conn: JiraConn,
  ids: Ids,
  key: string,
): Promise<JiraAnswer<Seen>> {
  const res = await jiraGet(
    conn.baseUrl,
    conn.token,
    `/rest/api/2/issue/${encodeURIComponent(key)}?fields=${fieldList(ids)}`,
    "no-ticket",
  );
  if (!res.ok) return res;
  const seen = seenFrom(res.data, conn.baseUrl, ids);
  return seen ? { ok: true, data: seen } : NOT_JIRA;
}

/**
 * The tickets with these numbers. One of them may be a ticket this token
 * cannot see (an epic naming a COORD in a project it has no access to), and
 * some Jiras refuse the whole search over that. Then the first few are read
 * one at a time and the hidden ones are simply not there.
 */
async function byKeys(
  conn: JiraConn,
  ids: Ids,
  keys: string[],
): Promise<JiraAnswer<Found>> {
  const all: Seen[] = [];
  let capped = false;
  for (let i = 0; i < keys.length; i += KEYS_PER_SEARCH) {
    const some = keys.slice(i, i + KEYS_PER_SEARCH);
    const res = await search(conn, ids, `key in (${some.join(", ")}) ORDER BY key ASC`, 1);
    if (res.ok) {
      all.push(...res.data.seen);
      continue;
    }
    if (res.why !== "error") return res;
    capped ||= some.length > ONE_BY_ONE;
    for (const key of some.slice(0, ONE_BY_ONE)) {
      const single = await one(conn, ids, key);
      if (single.ok) all.push(single.data);
      else if (single.why !== "no-ticket" && single.why !== "forbidden") return single;
    }
  }
  return { ok: true, data: { seen: all, capped } };
}

const unique = (keys: (string | null)[]) => [
  ...new Set(keys.filter((k): k is string => !!k)),
];

/**
 * Hang stories under their epics, and epics under the tickets above them.
 * Anything whose parent was not read hangs loose. A ticket is placed once: one
 * that is here as a COORD or an epic is not also a piece of work.
 */
function forestOf(coords: Seen[], epics: Seen[], stories: Seen[]): PullForest {
  const placed = new Set<string>();
  const forest: PullForest = { coords: [], epics: [], loose: [] };

  const coordNodes = new Map<string, PullForest["coords"][number]>();
  for (const c of coords) {
    if (placed.has(c.ticket.key)) continue;
    placed.add(c.ticket.key);
    const node = { ticket: c.ticket, epics: [] };
    coordNodes.set(c.ticket.key, node);
    forest.coords.push(node);
  }
  const epicNodes = new Map<string, PulledEpic>();
  for (const e of epics) {
    if (placed.has(e.ticket.key)) continue;
    placed.add(e.ticket.key);
    const node = { ticket: e.ticket, stories: [] };
    epicNodes.set(e.ticket.key, node);
    const above = e.parentKey ? coordNodes.get(e.parentKey) : undefined;
    if (above) above.epics.push(node);
    else forest.epics.push(node);
  }
  for (const s of stories) {
    if (placed.has(s.ticket.key)) continue;
    placed.add(s.ticket.key);
    const under = s.epicKey ? epicNodes.get(s.epicKey) : undefined;
    if (under) under.stories.push(s.ticket);
    else forest.loose.push(s.ticket);
  }
  return forest;
}

/**
 * The epics these stories name, and the tickets those epics name, read in two
 * searches as a rule: enough to hang a handful of tickets where they belong.
 */
async function withParents(
  conn: JiraConn,
  ids: Ids,
  stories: Seen[],
  epics: Seen[],
): Promise<JiraAnswer<{ forest: PullForest; capped: boolean }>> {
  let capped = false;
  const have = new Set(epics.map((e) => e.ticket.key));
  const missing = unique(stories.map((s) => s.epicKey)).filter((k) => !have.has(k));
  let allEpics = epics;
  if (missing.length > 0) {
    capped ||= missing.length > MAX_PARENTS;
    const res = await byKeys(conn, ids, missing.slice(0, MAX_PARENTS));
    if (!res.ok) return res;
    allEpics = [...epics, ...res.data.seen];
    capped ||= res.data.capped;
  }
  const above = unique(allEpics.map((e) => e.parentKey));
  let coords: Seen[] = [];
  if (above.length > 0) {
    capped ||= above.length > MAX_PARENTS;
    const res = await byKeys(conn, ids, above.slice(0, MAX_PARENTS));
    if (!res.ok) return res;
    coords = res.data.seen;
    capped ||= res.data.capped;
  }
  return { ok: true, data: { forest: forestOf(coords, allEpics, stories), capped } };
}

export type PullSource =
  /** One ticket by number: a COORD, an epic or a single story. `children` brings what hangs under it. */
  | { kind: "ticket"; key: string; children: boolean }
  /** Everything open that is assigned to the token's owner. */
  | { kind: "mine" };

export type PullRead = {
  forest: PullForest;
  /** True when a search hit its ceiling: there is more in Jira than was read. */
  capped: boolean;
  /** False when Jira would not say whose token this is, so no ticket could be marked as theirs. */
  whoKnown: boolean;
};

/**
 * Read what `source` names from the connected Jira, hung the way Jira hangs
 * it. Nothing is stored and nothing is made: this is what the screen shows
 * before "Bring in".
 */
export async function readPull(
  conn: JiraConn,
  source: PullSource,
): Promise<JiraAnswer<PullRead>> {
  const fields = await linkFields(conn);
  if (!fields.ok) return fields;

  if (source.kind === "mine") {
    // The search itself says whose these are, so nobody is asked who the owner is.
    const ids: Ids = { ...fields.data, me: NOBODY };
    const mine = await search(
      conn,
      ids,
      "assignee = currentUser() AND resolution = Unresolved ORDER BY key ASC",
    );
    if (!mine.ok) return mine;
    for (const s of mine.data.seen) s.ticket.mine = true;
    const assigned = new Set(mine.data.seen.map((s) => s.ticket.key));
    const epics = mine.data.seen.filter((s) => s.isEpic);
    // A sub-task whose story is in this pull too is that story's detail, not a second task.
    const stories = mine.data.seen.filter(
      (s) => !s.isEpic && !(s.subtaskOf && assigned.has(s.subtaskOf)),
    );
    const hung = await withParents(conn, ids, stories, epics);
    if (!hung.ok) return hung;
    return {
      ok: true,
      data: {
        forest: hung.data.forest,
        capped: mine.data.capped || hung.data.capped,
        whoKnown: true,
      },
    };
  }

  const key = ticketKeyFrom(source.key);
  if (!key) {
    return {
      ok: false,
      why: "no-ticket",
      error: "That is not a ticket number.",
    };
  }
  const me = await owner(conn);
  const whoKnown = me !== null;
  const ids: Ids = { ...fields.data, me: me ?? NOBODY };
  const top = await one(conn, ids, key);
  if (!top.ok) return top;

  if (top.data.isEpic) {
    let stories: Seen[] = [];
    let capped = false;
    if (source.children && ids.epicLink) {
      const under = await search(conn, ids, `${cf(ids.epicLink)} = ${key} ORDER BY key ASC`);
      if (!under.ok) return under;
      stories = under.data.seen;
      capped = under.data.capped;
    }
    const hung = await withParents(conn, ids, stories, [top.data]);
    if (!hung.ok) return hung;
    return {
      ok: true,
      data: { forest: hung.data.forest, capped: capped || hung.data.capped, whoKnown },
    };
  }

  // A ticket that names an epic is a piece of work, whatever its type is called. Nothing hangs under it.
  if (!top.data.epicKey && ids.parentLink) {
    // Without its children one page is enough: all that is asked is whether anything hangs here.
    const under = await search(
      conn,
      ids,
      `${cf(ids.parentLink)} = ${key} ORDER BY key ASC`,
      source.children ? MAX_PAGES : 1,
    );
    if (!under.ok) return under;
    const epics = under.data.seen;
    if (epics.length > 0) {
      if (!source.children) {
        // A COORD brought in alone: the project, and nothing in it yet.
        return {
          ok: true,
          data: { forest: forestOf([top.data], [], []), capped: false, whoKnown },
        };
      }
      let capped = under.data.capped;
      const stories: Seen[] = [];
      if (ids.epicLink) {
        const keys = epics.map((e) => e.ticket.key);
        for (let i = 0; i < keys.length; i += KEYS_PER_SEARCH) {
          const some = keys.slice(i, i + KEYS_PER_SEARCH);
          const found = await search(
            conn,
            ids,
            `${cf(ids.epicLink)} in (${some.join(", ")}) ORDER BY key ASC`,
          );
          if (!found.ok) return found;
          stories.push(...found.data.seen);
          capped ||= found.data.capped;
        }
      }
      return {
        ok: true,
        data: { forest: forestOf([top.data], epics, stories), capped, whoKnown },
      };
    }
  }

  // Nothing hangs under it: one piece of work, hung where it belongs.
  const hung = await withParents(conn, ids, [top.data], []);
  if (!hung.ok) return hung;
  return { ok: true, data: { ...hung.data, whoKnown } };
}
