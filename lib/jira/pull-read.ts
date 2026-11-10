import "server-only";

import { jiraIssueUrl } from "@/lib/jira/address";
import { jiraGet, type JiraAnswer } from "@/lib/jira/client";
import { jiraFactsFrom } from "@/lib/jira/issue";
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

/** The ids of the two link fields on one Jira. Null when that Jira has no such field. */
export type LinkFields = { epicLink: string | null; parentLink: string | null };

const EPIC_LINK_KIND = "com.pyxis.greenhopper.jira:gh-epic-link";
const PARENT_LINK_KIND = "com.atlassian.jpo:jpo-custom-field-parent";
const FIELD_ID = /^customfield_(\d{1,9})$/;

/**
 * The two link fields out of Jira's list of fields. Found by the kind of
 * field first, which survives a rename, and by name only as a fallback.
 */
export function linkFieldsFrom(raw: unknown): LinkFields {
  const found: LinkFields = { epicLink: null, parentLink: null };
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

/** One ticket as read, with the two tickets it names above itself. */
type Seen = {
  ticket: PulledTicket;
  type: string | null;
  epicKey: string | null;
  parentKey: string | null;
};

function seenFrom(raw: unknown, base: string, ids: LinkFields): Seen | null {
  const facts = jiraFactsFrom(raw);
  if (!facts) return null;
  const fields = obj(obj(raw)?.fields) ?? {};
  return {
    ticket: {
      key: facts.key,
      title: facts.title ?? facts.key,
      stage: facts.stage,
      url: jiraIssueUrl(base, facts.key),
    },
    type: facts.type,
    epicKey: ids.epicLink ? keyIn(fields[ids.epicLink]) : null,
    parentKey: ids.parentLink ? keyIn(fields[ids.parentLink]) : null,
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
/** Numbers per "key in (...)", so the address of the request stays a sane length. */
const KEYS_PER_SEARCH = 60;

const fieldList = (ids: LinkFields) =>
  ["summary", "status", "issuetype", ids.epicLink, ids.parentLink]
    .filter(Boolean)
    .join(",");

/** `cf[10101]`, JQL's way to name a custom field by its id. */
const cf = (id: string) => `cf[${FIELD_ID.exec(id)![1]}]`;

// Fields rarely change. Asking once per Jira every ten minutes saves a request on every pull.
const FIELDS_FOR = new Map<string, { at: number; ids: LinkFields }>();
const FIELDS_FRESH_MS = 10 * 60 * 1000;

async function linkFields(conn: JiraConn): Promise<JiraAnswer<LinkFields>> {
  const hit = FIELDS_FOR.get(conn.baseUrl);
  if (hit && Date.now() - hit.at < FIELDS_FRESH_MS) {
    return { ok: true, data: hit.ids };
  }
  const res = await jiraGet(conn.baseUrl, conn.token, "/rest/api/2/field");
  if (!res.ok) return res;
  if (!Array.isArray(res.data)) return NOT_JIRA;
  const ids = linkFieldsFrom(res.data);
  FIELDS_FOR.set(conn.baseUrl, { at: Date.now(), ids });
  return { ok: true, data: ids };
}

/** Forget what was learned about every Jira's fields. For tests, and for a connection that changed. */
export function forgetLinkFields(): void {
  FIELDS_FOR.clear();
}

async function search(
  conn: JiraConn,
  ids: LinkFields,
  jql: string,
): Promise<JiraAnswer<{ seen: Seen[]; capped: boolean }>> {
  const seen: Seen[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const res = await jiraGet(
      conn.baseUrl,
      conn.token,
      `/rest/api/2/search?jql=${encodeURIComponent(jql)}&fields=${fieldList(ids)}&startAt=${page * PAGE}&maxResults=${PAGE}`,
    );
    if (!res.ok) return res;
    const body = obj(res.data);
    if (!body || !Array.isArray(body.issues)) return NOT_JIRA;
    for (const raw of body.issues) {
      const one = seenFrom(raw, conn.baseUrl, ids);
      if (one) seen.push(one);
    }
    const total = typeof body.total === "number" ? body.total : 0;
    if (body.issues.length === 0 || (page + 1) * PAGE >= total) {
      return { ok: true, data: { seen, capped: false } };
    }
  }
  return { ok: true, data: { seen, capped: true } };
}

/** The tickets with these numbers, in as few searches as they fit in. */
async function byKeys(
  conn: JiraConn,
  ids: LinkFields,
  keys: string[],
): Promise<JiraAnswer<{ seen: Seen[]; capped: boolean }>> {
  const all: Seen[] = [];
  let capped = false;
  for (let i = 0; i < keys.length; i += KEYS_PER_SEARCH) {
    const some = keys.slice(i, i + KEYS_PER_SEARCH);
    const res = await search(conn, ids, `key in (${some.join(", ")}) ORDER BY key ASC`);
    if (!res.ok) return res;
    all.push(...res.data.seen);
    capped ||= res.data.capped;
  }
  return { ok: true, data: { seen: all, capped } };
}

async function one(
  conn: JiraConn,
  ids: LinkFields,
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

const unique = (keys: (string | null)[]) => [
  ...new Set(keys.filter((k): k is string => !!k)),
];

/** Hang stories under their epics, and epics under the tickets above them. Anything whose parent was not read hangs loose. */
function forestOf(coords: Seen[], epics: Seen[], stories: Seen[]): PullForest {
  const epicNodes = new Map<string, PulledEpic>();
  for (const e of epics) epicNodes.set(e.ticket.key, { ticket: e.ticket, stories: [] });
  const forest: PullForest = { coords: [], epics: [], loose: [] };
  for (const s of stories) {
    const under = s.epicKey ? epicNodes.get(s.epicKey) : undefined;
    if (under) under.stories.push(s.ticket);
    else forest.loose.push(s.ticket);
  }
  const coordNodes = new Map<string, PullForest["coords"][number]>();
  for (const c of coords) {
    const node = { ticket: c.ticket, epics: [] };
    coordNodes.set(c.ticket.key, node);
    forest.coords.push(node);
  }
  for (const e of epics) {
    const node = epicNodes.get(e.ticket.key)!;
    const above = e.parentKey ? coordNodes.get(e.parentKey) : undefined;
    if (above) above.epics.push(node);
    else forest.epics.push(node);
  }
  return forest;
}

/**
 * The epics these stories name, and the tickets those epics name, read in two
 * searches at most: enough to hang a handful of tickets where they belong.
 */
async function withParents(
  conn: JiraConn,
  ids: LinkFields,
  stories: Seen[],
  epics: Seen[],
): Promise<JiraAnswer<{ forest: PullForest; capped: boolean }>> {
  let capped = false;
  const have = new Set(epics.map((e) => e.ticket.key));
  const missing = unique(stories.map((s) => s.epicKey)).filter((k) => !have.has(k));
  let allEpics = epics;
  if (missing.length > 0) {
    const res = await byKeys(conn, ids, missing);
    if (!res.ok) return res;
    allEpics = [...epics, ...res.data.seen];
    capped ||= res.data.capped;
  }
  const above = unique(allEpics.map((e) => e.parentKey));
  let coords: Seen[] = [];
  if (above.length > 0) {
    const res = await byKeys(conn, ids, above);
    if (!res.ok) return res;
    coords = res.data.seen;
    capped ||= res.data.capped;
  }
  return { ok: true, data: { forest: forestOf(coords, allEpics, stories), capped } };
}

/** The kinds of ticket that are work to do, never a container of other work. */
const LEAF_TYPES = new Set(["story", "task", "bug", "sub-task", "subtask", "improvement", "spike"]);

export type PullSource =
  /** One ticket by number: a COORD, an epic or a single story. `children` brings what hangs under it. */
  | { kind: "ticket"; key: string; children: boolean }
  /** Everything open that is assigned to the token's owner. */
  | { kind: "mine" };

export type PullRead = {
  forest: PullForest;
  /** True when a search hit its ceiling: there is more in Jira than was read. */
  capped: boolean;
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
  const ids = fields.data;

  if (source.kind === "mine") {
    const mine = await search(
      conn,
      ids,
      "assignee = currentUser() AND resolution = Unresolved ORDER BY key ASC",
    );
    if (!mine.ok) return mine;
    const epics = mine.data.seen.filter((s) => s.type === "Epic");
    const stories = mine.data.seen.filter((s) => s.type !== "Epic");
    const hung = await withParents(conn, ids, stories, epics);
    if (!hung.ok) return hung;
    return {
      ok: true,
      data: { forest: hung.data.forest, capped: mine.data.capped || hung.data.capped },
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
  const top = await one(conn, ids, key);
  if (!top.ok) return top;

  if (top.data.type === "Epic") {
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
    return { ok: true, data: { forest: hung.data.forest, capped: capped || hung.data.capped } };
  }

  // Not an epic: either a ticket that epics hang under, or a single piece of work.
  let epics: Seen[] = [];
  let capped = false;
  if (ids.parentLink) {
    const under = await search(conn, ids, `${cf(ids.parentLink)} = ${key} ORDER BY key ASC`);
    if (!under.ok) return under;
    epics = under.data.seen;
    capped = under.data.capped;
  }

  if (epics.length > 0) {
    let stories: Seen[] = [];
    if (source.children && ids.epicLink) {
      const keys = epics.map((e) => e.ticket.key);
      for (let i = 0; i < keys.length; i += KEYS_PER_SEARCH) {
        const some = keys.slice(i, i + KEYS_PER_SEARCH);
        const under = await search(
          conn,
          ids,
          `${cf(ids.epicLink)} in (${some.join(", ")}) ORDER BY key ASC`,
        );
        if (!under.ok) return under;
        stories.push(...under.data.seen);
        capped ||= under.data.capped;
      }
    }
    // Without its children a COORD is brought in alone: the project, and nothing in it yet.
    const kept = source.children ? epics : [];
    if (!source.children) stories = [];
    return {
      ok: true,
      data: { forest: forestOf([top.data], kept, stories), capped },
    };
  }

  const leaf = !!top.data.epicKey || LEAF_TYPES.has((top.data.type ?? "").toLowerCase());
  if (!leaf) {
    // Nothing hangs under it yet, and it is not a kind of work: a COORD with no epics.
    return { ok: true, data: { forest: forestOf([top.data], [], []), capped } };
  }
  const hung = await withParents(conn, ids, [top.data], []);
  if (!hung.ok) return hung;
  return { ok: true, data: { forest: hung.data.forest, capped: capped || hung.data.capped } };
}
