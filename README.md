# dprint_automation

Common scripts used across repos.

## Creating a Process Plugin File

```ts
// create_process_plugin.ts
import {
  extractCargoVersion,
  processPlugin,
  // replace X.X.X with the latest tag in this repo
} from "https://raw.githubusercontent.com/dprint/automation/X.X.X/mod.ts";
import * as path from "https://deno.land/std@0.130.0/path/mod.ts";

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
  zipUrl: `https://github.com/your-org-or-user/${pluginName}/releases/download/${builder.version}/${zipFileName}`,
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
