import { cache } from "react";
import * as memory from "./memory/habits";
import * as mongo from "./mongo/habits";

const impl = process.env.DATA_SOURCE === "mongodb" ? mongo : memory;

export const listHabits = cache(impl.listHabits);
export const insertHabit = impl.insertHabit;
export const updateHabit = impl.updateHabit;
export const deleteHabit = impl.deleteHabit;
export const updateHabitsOrder = impl.updateHabitsOrder;
