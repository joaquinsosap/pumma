import { cache } from "react";
import * as memory from "./memory/tasks";
import * as mongo from "./mongo/tasks";

const impl = process.env.DATA_SOURCE === "mongodb" ? mongo : memory;

export const listTasks = cache(impl.listTasks);
export const getTask = cache(impl.getTask);
export const getTasksByDue = cache(impl.getTasksByDue);
export const getCarryoverTasks = cache(impl.getCarryoverTasks);
export const getTasksByProject = cache(impl.getTasksByProject);
export const getRunningTimerTask = cache(impl.getRunningTimerTask);
// Not cache()-wrapped: the id list is a fresh array on every call, so React's
// per-argument identity cache would never hit — these are one-shot batch
// reads, not the kind of repeated call cache() is for.
export const getTasksByIds = impl.getTasksByIds;
export const insertTask = impl.insertTask;
export const insertTasks = impl.insertTasks;
export const updateTask = impl.updateTask;
export const updateTasks = impl.updateTasks;
export const accumulateRunningTime = impl.accumulateRunningTime;
export const stopRunningTimers = impl.stopRunningTimers;
export const deleteTask = impl.deleteTask;
export const deleteTasks = impl.deleteTasks;
