import { cache } from "react";
import * as memory from "./memory/calendar-feeds";
import * as mongo from "./mongo/calendar-feeds";

const impl = process.env.DATA_SOURCE === "mongodb" ? mongo : memory;

export const listFeeds = cache(impl.listFeeds);
export const getFeed = impl.getFeed;
export const insertFeed = impl.insertFeed;
export const updateFeed = impl.updateFeed;
export const deleteFeed = impl.deleteFeed;
export const listExternalEvents = cache(impl.listExternalEvents);
export const replaceFeedEvents = impl.replaceFeedEvents;
