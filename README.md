# dprint automation

Common scripts used across repos.

## Creating a Process Plugin File

```
> deno add jsr:@dprint/automation jsr:@std/semver
```

```ts
// create_process_plugin.ts
import {
  extractCargoVersion,
  processPlugin,
} from "@dprint/automation";
import * as path from "path";

const pluginName = "your-plugin-name";

const currentDirPath = path.dirname(path.fromFileUrl(import.meta.url));
// only if using cargo... otherwise find another way to get the version
const cargoFilePath = path.join(currentDirPath, "../", "Cargo.toml");

const builder = new PluginFileBuilder({
  name: pluginName,
  version: await extractCargoVersion(cargoFilePath),
});

// then for each platform do something like:
const zipFileName = processPlugin.getStandardZipFileName(pluginName, "windows-x86_64");
await builder.addPlatform({
  platform: "windows-x86_64,
  zipFilePath: `path/to/${zipFileName}`,
  // this can be a relative url starting in dprint 0.53.1, but there was sadly a bug
  // in order versions that doesn't allow it (see https://github.com/dprint/dprint/pull/1114)
  zipUrl: `https://plugins.dprint.dev/your-org-or-user/your-repo-name/${builder.version}/asset/${zipFileName}`,
});

// write it to a file
await builder.writeToPath("plugin.json");
```

1. Build each plugin for each platform.
2. Zip the binaries into zip files.
3. Run this script:
   ```shell
   deno run --allow-read=. --allow-write=. create_process_plugin.ts
   ```
4. Upload the `plugin.json` file and all the zip files to the GitHub release.

## Publishing a Config Schema

A wasm plugin's config schema can have code examples that https://dprint.dev shows in the plugin's configuration documentation. Declare one with an `x-example` on a property, or on the definition named after the property:

```jsonc
"quoteStyle": {
  "$ref": "#/definitions/quoteStyle",
  "x-example": {
    // optional, the configuration besides the property
    "config": { "lineWidth": 40 },
    // optional, defaults to the --extension argument below
    "extension": "tsx",
    "input": [
      "const single = 'text';",
      "const double = \"text\";"
    ]
  }
}
```

Then on CI, after building the plugin, run:

```shell
deno run -A jsr:@dprint/automation/tasks/publish-schema path/to/plugin.wasm path/to/schema.json --extension ts
```

This formats each example's input with each value of its property and adds the outputs to the schema as `"outputs": { "<value>": "<formatted text>" }`, where a value that isn't a string is in JSON (ex. `"true"`). Upload the schema to the release after it runs.

It fails when the plugin has a diagnostic for the default of any property in the schema (ex. a property the plugin doesn't know about) or when an example formats the same with every value of its property.

The schema can also group its properties into sections, which dprint.dev shows as headings with a table of contents. Declare them in order at the root of the schema:

```jsonc
"x-sections": [{
  "title": "Imports and exports",
  "description": "The sorting and line breaks of import and export declarations.",
  "properties": ["module.sortImportDeclarations", "importDeclaration.forceSingleLine"]
}]
```

A property that refers to another property's definition or whose last segment is another property's name (ex. `classExpression.memberSpacing` with `memberSpacing`) is shown under that property, so it isn't listed. When a schema has sections, the task fails unless every other property is in exactly one of them.
