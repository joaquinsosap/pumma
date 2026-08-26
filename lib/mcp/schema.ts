/**
 * Making this repo's Zod usable as an MCP tool schema.
 *
 * The SDK asks a schema for two things: `~standard.validate` to check incoming
 * arguments, and `~standard.jsonSchema` to publish the argument shape in
 * `tools/list`. Zod 4.1+ provides both. This repo is on zod 3.25 through its
 * `zod/v4` entry, which provides only the first, so `registerTool` rejects
 * every schema here.
 *
 * The alternative was upgrading zod outright, and that is a much larger change
 * than it sounds: `lib/validation.ts`, `lib/schemas` and every server action
 * import the v3 API from "zod", which zod 4 replaces. Trading a whole
 * codebase's validation layer for one missing property is not a good deal, and
 * it would land inside the same commit as a new public endpoint.
 *
 * So this adds the missing property and nothing else, built on the
 * `z.toJSONSchema` that ships in the same package. When zod moves up, this
 * file deletes: the shim is a no-op if `jsonSchema` is already present.
 */
import * as z from "zod/v4";
import type { StandardSchemaWithJSON } from "@modelcontextprotocol/server";

/**
 * The two libraries spell the JSON Schema drafts differently, and zod does not
 * throw on a name it does not know: it logs and returns a document anyway. A
 * silently mis-targeted schema is exactly the kind of thing that surfaces as
 * "one particular client rejects our tools", so map explicitly and fall back
 * to the draft MCP actually uses.
 */
function zodTarget(target?: string): "draft-2020-12" | "draft-7" {
  if (target === "draft-07") return "draft-7";
  if (target === "draft-2020-12") return "draft-2020-12";
  return "draft-2020-12";
}

/**
 * Attach the JSON Schema converter to a Zod schema and hand it back typed as
 * something `registerTool` accepts.
 *
 * Mutates the schema's own `~standard` object, which is safe here in a way it
 * usually would not be: it is a plain writable own property, unique to this
 * schema instance, and the addition is idempotent. Wrapping in a new object
 * instead would break `validate`, which is bound to the schema it came from.
 */
export function toolInput<S extends z.ZodType>(
  schema: S,
): S & StandardSchemaWithJSON<z.input<S>, z.output<S>> {
  const std = (schema as unknown as Record<string, Record<string, unknown>>)[
    "~standard"
  ];
  if (std && !std.jsonSchema) {
    std.jsonSchema = {
      input: (options?: { target?: string }) =>
        z.toJSONSchema(schema, { target: zodTarget(options?.target), io: "input" }),
      output: (options?: { target?: string }) =>
        z.toJSONSchema(schema, { target: zodTarget(options?.target), io: "output" }),
    };
  }
  return schema as S & StandardSchemaWithJSON<z.input<S>, z.output<S>>;
}
