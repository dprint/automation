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
