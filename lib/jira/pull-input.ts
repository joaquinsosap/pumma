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
    /** Ticket numbers unticked in the tree. */
    off: z.array(z.string().max(60)).max(2000),
  })
  .strict();

export type PullRunInput = z.infer<typeof pullRunSchema>;
