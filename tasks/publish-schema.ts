// Prepares a wasm plugin's config schema to be uploaded to a release by adding
// the outputs of its code examples (see `prepareSchemaForPublish`).
//
// Usage: deno run -A jsr:@dprint/automation/tasks/publish-schema <plugin.wasm> <schema.json> [--extension <ext>]
//
// This overwrites the schema file.

import { createFromBuffer } from "@dprint/formatter";
import { prepareSchemaForPublish } from "../schema.ts";

const cliArgs = getCliArgs();
const schema = JSON.parse(Deno.readTextFileSync(cliArgs.schemaPath));
const formatter = createFromBuffer(Deno.readFileSync(cliArgs.wasmPath));
prepareSchemaForPublish(schema, formatter, { extension: cliArgs.extension });
Deno.writeTextFileSync(cliArgs.schemaPath, JSON.stringify(schema, undefined, 2) + "\n");

function getCliArgs() {
  // very basic arg parsing
  const paths: string[] = [];
  let extension: string | undefined = undefined;

  for (let i = 0; i < Deno.args.length; i++) {
    const arg = Deno.args[i]!;
    if (arg === "--extension") {
      extension = Deno.args[++i];
      if (extension == null) {
        throw new Error("Expected an extension after --extension.");
      }
    } else if (arg.startsWith("--")) {
      throw new Error(`Invalid argument: ${arg}`);
    } else {
      paths.push(arg);
    }
  }
  if (paths.length !== 2) {
    throw new Error("Usage: publish-schema <plugin.wasm> <schema.json> [--extension <ext>]");
  }
  return {
    wasmPath: paths[0]!,
    schemaPath: paths[1]!,
    extension,
  };
}
