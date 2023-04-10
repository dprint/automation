import { getChecksum } from "./hash.ts";

export type Platform =
  | "darwin-x86_64"
  | "darwin-aarch64"
  | "linux-x86_64"
  | "linux-x86_64-musl"
  | "linux-aarch64"
  | "linux-aarch64-musl"
  | "windows-x86_64"
  | "windows-aarch64";

export function getStandardZipFileName(pluginName: string, platform: Platform) {
  switch (platform) {
    case "darwin-x86_64":
      return `${pluginName}-x86_64-apple-darwin.zip`;
    case "darwin-aarch64":
      return `${pluginName}-aarch64-apple-darwin.zip`;
    case "linux-x86_64":
      return `${pluginName}-x86_64-unknown-linux-gnu.zip`;
    case "linux-x86_64-musl":
      return `${pluginName}-x86_64-unknown-linux-musl.zip`;
    case "linux-aarch64":
      return `${pluginName}-aarch64-unknown-linux-gnu.zip`;
    case "linux-aarch64-musl":
      return `${pluginName}-aarch64-unknown-linux-musl.zip`;
    case "windows-x86_64":
      return `${pluginName}-x86_64-pc-windows-msvc.zip`;
    case "windows-aarch64":
      return `${pluginName}-aarch64-pc-windows-msvc.zip`;
    default:
      const _never: never = platform;
      throw new Error(`Not supported platform: ${platform}`);
  }
}

export function getCurrentPlatform() {
  if (Deno.build.os !== "linux" && Deno.build.os !== "darwin" && Deno.build.os !== "windows") {
    throw new Error("Not supported operating system: " + Deno.build.os);
  }
  return `${Deno.build.os}-${Deno.build.arch}` as const;
}

export interface AddPlatformOptions {
  /** The platform this is for. */
  platform: Platform;
  /** The path to the zip file on the file system. */
  zipFilePath: string;
  /** The url that this zip file will be distributed at. */
  zipUrl: string;
}

export interface PluginFileBuilderOptions {
  /** Name of the plugin. */
  name: string;
  /** Version of the plugin. */
  version: string;
}

export class PluginFileBuilder {
  #output: any = {
    schemaVersion: 2,
    kind: "process",
  };

  constructor(options: PluginFileBuilderOptions) {
    this.#output.name = options.name;
    this.#output.version = options.version;
  }

  get pluginName() {
    return this.#output.name as string;
  }

  get version() {
    return this.#output.version as string;
  }

  async addPlatform(options: AddPlatformOptions) {
    const fileBytes = await Deno.readFile(options.zipFilePath);
    const checksum = await getChecksum(fileBytes);
    console.log(options.zipFilePath + ": " + checksum);
    this.#output[options.platform] = {
      "reference": options.zipUrl,
      "checksum": checksum,
    };
  }

  async writeToPath(filePath: string) {
    const text = this.outputText();
    const checksum = await this.outputTextChecksum();
    console.log(filePath + ": " + checksum);
    await Deno.writeTextFile(filePath, text);
  }

  outputTextChecksum() {
    const text = this.outputText();
    return getChecksum(new TextEncoder().encode(text));
  }

  outputText() {
    return JSON.stringify(this.#output, undefined, 2) + "\n";
  }
}

/** Creates a process plugin for the dprint GitHub organization. */
export async function createDprintOrgProcessPlugin({ pluginName, version, platforms, isTest }: {
  pluginName: string;
  version: string;
  platforms: Platform[];
  /** Creates a plugin file with only the current platform using
   * a zip file in the current folder.
   */
  isTest: boolean;
}) {
  const builder = new PluginFileBuilder({
    name: pluginName,
    version: version,
  });

  if (isTest) {
    const platform = getCurrentPlatform();
    const zipFileName = getStandardZipFileName(builder.pluginName, platform);
    await builder.addPlatform({
      platform,
      zipFilePath: zipFileName,
      zipUrl: zipFileName,
    });
  } else {
    for (const platform of platforms) {
      await addPlatform(platform);
    }
  }

  await builder.writeToPath("plugin.json");

  async function addPlatform(platform: Platform) {
    const zipFileName = getStandardZipFileName(builder.pluginName, platform);
    const zipUrl = `https://github.com/dprint/${pluginName}/releases/download/${builder.version}/${zipFileName}`;
    await builder.addPlatform({
      platform,
      zipFilePath: zipFileName,
      zipUrl,
    });
  }
}
