// The shapes the two pull routes accept. Free of server imports, so the screen can use the types.
import { z } from "zod";

export const pullSourceSchema = z.union([
  z
    .object({
      kind: z.literal("ticket"),
      key: z.string().trim().min(1).max(60),
      children: z.boolean(),
    })
    .strict(),
  z.object({ kind: z.literal("mine") }).strict(),
]);

export const pullRunSchema = z
  .object({
    source: pullSourceSchema,
    level: z.enum(["coord", "epic"]),
    /** Ticket numbers unticked in the tree. One pull reads 2101 tickets at most, and "None" unticks most of them. */
    off: z.array(z.string().max(60)).max(3000),
    /** The selectors over the tree. Sent as they are set, not as the tickets they hid: a read made again at bring-in is narrowed the same way. */
    who: z.enum(["all", "mine"]),
    stages: z.array(z.enum(["todo", "doing", "done"])).max(3),
  })
  .strict();

export type PullRunInput = z.infer<typeof pullRunSchema>;
