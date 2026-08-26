import { getStore, newId } from "@/lib/store/memory";
import {
  toDto,
  calendarFeedSchema,
  externalEventSchema,
  type CalendarFeed,
  type CalendarFeedDoc,
  type ExternalEvent,
  type ExternalEventDoc,
} from "@/lib/schemas";

/**
 * The store, with these two collections guaranteed to exist.
 *
 * getStore() caches on globalThis and survives hot reload, so a store built
 * before these collections were added outlives the code that added them and
 * every read here is on undefined. Seeding them on the way past is cheaper
 * than making everyone restart, and it is also what an older persisted store
 * would need.
 */
function store() {
  const s = getStore();
  s.calendarFeeds ??= [];
  s.externalEvents ??= [];
  return s;
}

export async function listFeeds(userId: string): Promise<CalendarFeed[]> {
  return store()
    .calendarFeeds.filter((f) => f.userId === userId)
    .map((f) => toDto(calendarFeedSchema.parse(f)));
}

export async function getFeed(
  userId: string,
  id: string,
): Promise<CalendarFeed | null> {
  const doc = store().calendarFeeds.find(
    (f) => f._id === id && f.userId === userId,
  );
  return doc ? toDto(calendarFeedSchema.parse(doc)) : null;
}

export async function insertFeed(
  doc: Omit<CalendarFeedDoc, "_id"> & { _id?: string },
): Promise<CalendarFeed> {
  const full = calendarFeedSchema.parse({ ...doc, _id: doc._id ?? newId() });
  store().calendarFeeds.push(full);
  return toDto(full);
}

export async function updateFeed(
  userId: string,
  id: string,
  patch: Partial<Omit<CalendarFeedDoc, "_id" | "userId">>,
): Promise<CalendarFeed | null> {
  const st = store();
  const i = st.calendarFeeds.findIndex(
    (f) => f._id === id && f.userId === userId,
  );
  if (i < 0) return null;
  const next = calendarFeedSchema.parse({ ...st.calendarFeeds[i], ...patch });
  st.calendarFeeds[i] = next;
  return toDto(next);
}

export async function deleteFeed(userId: string, id: string): Promise<boolean> {
  const st = store();
  const before = st.calendarFeeds.length;
  st.calendarFeeds = st.calendarFeeds.filter(
    (f) => !(f._id === id && f.userId === userId),
  );
  // The events go with it. They are a cache of that feed and nothing else.
  st.externalEvents = st.externalEvents.filter((e) => e.feedId !== id);
  return st.calendarFeeds.length < before;
}

export async function listExternalEvents(
  userId: string,
): Promise<ExternalEvent[]> {
  return store()
    .externalEvents.filter((e) => e.userId === userId)
    .map((e) => toDto(externalEventSchema.parse(e)));
}

/**
 * Replace everything this feed had with what it has now.
 *
 * Wholesale rather than a diff: the events are a disposable projection of the
 * feed, the feed is small, and a replace cannot leave an orphan behind the way
 * a partial update can when an event silently disappears upstream.
 */
export async function replaceFeedEvents(
  userId: string,
  feedId: string,
  events: (Omit<ExternalEventDoc, "_id" | "userId" | "feedId"> & {
    _id?: string;
  })[],
): Promise<number> {
  const st = store();
  st.externalEvents = st.externalEvents.filter(
    (e) => !(e.feedId === feedId && e.userId === userId),
  );
  for (const e of events) {
    st.externalEvents.push(
      externalEventSchema.parse({ ...e, _id: e._id ?? newId(), userId, feedId }),
    );
  }
  return events.length;
}
