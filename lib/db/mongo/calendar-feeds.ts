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

export async function listExternalEvents(
  userId: string,
): Promise<ExternalEvent[]> {
  const docs = await (await events()).find({ userId }).toArray();
  const plain = await decryptAllFor("externalEvents", userId, docs);
  return plain.map((e) => toDto(externalEventSchema.parse(e)));
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
