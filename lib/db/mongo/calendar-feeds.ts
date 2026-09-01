import { getDb } from "@/lib/mongodb";
import {
  decryptAllFor,
  decryptFor,
  encryptFor,
} from "@/lib/db/mongo/encrypted";
import { newId } from "@/lib/store/memory";
import {
  toDto,
  calendarFeedSchema,
  externalEventSchema,
  type CalendarFeed,
  type CalendarFeedDoc,
  type ExternalEvent,
  type ExternalEventDoc,
} from "@/lib/schemas";

async function feeds() {
  const db = await getDb();
  return db.collection<CalendarFeedDoc>("calendarFeeds");
}

async function events() {
  const db = await getDb();
  return db.collection<ExternalEventDoc>("externalEvents");
}

export async function listFeeds(userId: string): Promise<CalendarFeed[]> {
  const docs = await (await feeds()).find({ userId }).toArray();
  const plain = await decryptAllFor("calendarFeeds", userId, docs);
  return plain.map((f) => toDto(calendarFeedSchema.parse(f)));
}

export async function getFeed(
  userId: string,
  id: string,
): Promise<CalendarFeed | null> {
  const doc = await (await feeds()).findOne({ _id: id, userId });
  if (!doc) return null;
  return toDto(
    calendarFeedSchema.parse(await decryptFor("calendarFeeds", userId, doc)),
  );
}

export async function insertFeed(
  doc: Omit<CalendarFeedDoc, "_id"> & { _id?: string },
): Promise<CalendarFeed> {
  const full = calendarFeedSchema.parse({ ...doc, _id: doc._id ?? newId() });
  await (await feeds()).insertOne(
    await encryptFor("calendarFeeds", full.userId, full),
  );
  return toDto(full);
}

export async function updateFeed(
  userId: string,
  id: string,
  patch: Partial<Omit<CalendarFeedDoc, "_id" | "userId">>,
): Promise<CalendarFeed | null> {
  const c = await feeds();
  const enc = await encryptFor("calendarFeeds", userId, patch);
  await c.updateOne({ _id: id, userId }, { $set: enc });
  return getFeed(userId, id);
}

export async function deleteFeed(userId: string, id: string): Promise<boolean> {
  const res = await (await feeds()).deleteOne({ _id: id, userId });
  // The events are a cache of this feed; nothing else refers to them.
  await (await events()).deleteMany({ userId, feedId: id });
  return res.deletedCount > 0;
}

/**
 * Every event, without the invite body.
 *
 * `notes` is 85% of this collection's bytes. A Teams or Zoom invite is two or
 * three kilobytes of join links, dial-in numbers and legal boilerplate, and
 * there are hundreds of them; only the day being looked at ever renders one.
 * The bodies are fetched separately, by listExternalEventBodies.
 *
 * Leaving it in made every page load pull a megabyte it did not use, which
 * over a link that moves ~90KB/s per socket is eleven seconds. That is not a
 * Mongo problem: the server executes this query in under a millisecond and
 * spends all the rest of it on the wire.
 */
export async function listExternalEvents(
  userId: string,
): Promise<ExternalEvent[]> {
  const docs = await (await events())
    .find({ userId })
    .project<Omit<ExternalEventDoc, "notes" | "key">>({ notes: 0, key: 0 })
    .toArray();
  const plain = await decryptAllFor("externalEvents", userId, docs);
  // `notes` defaults to "" in the schema, so a body-less row parses cleanly.
  //
  // `key` is put back as "" rather than fetched: it is the VEVENT UID plus a
  // start time, it averages 131 bytes across hundreds of rows, and it exists
  // only so ics.ts can collapse duplicate occurrences while parsing a feed.
  // Nothing reads it back out of the database. If something ever needs to,
  // fetch it there rather than making every agenda load carry it.
  return plain.map((e) => toDto(externalEventSchema.parse({ ...e, key: "" })));
}

/**
 * The invite bodies for a span of days, keyed by event id.
 *
 * A date range rather than ids because a range is what every caller already
 * knows: the agenda renders a day, a reminder looks a day or two ahead, the
 * MCP tool is handed a window. It also keeps this to one indexed query
 * however many meetings the span turns out to hold.
 *
 * Inclusive at both ends, and `to` may equal `from` for a single day.
 */
export async function listExternalEventBodies(
  userId: string,
  from: string,
  to: string,
): Promise<Record<string, string>> {
  const docs = await (await events())
    .find({ userId, date: { $gte: from, $lte: to } })
    .project<{ _id: string; notes?: string }>({ notes: 1 })
    .toArray();
  const plain = await decryptAllFor("externalEvents", userId, docs);
  return Object.fromEntries(plain.map((d) => [d._id, d.notes ?? ""]));
}

/** See the memory implementation for why this replaces rather than diffs. */
export async function replaceFeedEvents(
  userId: string,
  feedId: string,
  incoming: (Omit<ExternalEventDoc, "_id" | "userId" | "feedId"> & {
    _id?: string;
  })[],
): Promise<number> {
  const c = await events();
  await c.deleteMany({ userId, feedId });
  if (incoming.length === 0) return 0;
  const docs = await Promise.all(
    incoming.map(async (e) =>
      encryptFor(
        "externalEvents",
        userId,
        externalEventSchema.parse({
          ...e,
          _id: e._id ?? newId(),
          userId,
          feedId,
        }),
      ),
    ),
  );
  await c.insertMany(docs);
  return docs.length;
}
