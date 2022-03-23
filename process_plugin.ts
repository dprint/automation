import { getChecksum } from "./hash.ts";

export type Platform = "windows-x86_64" | "linux-x86_64" | "darwin-x86_64" | "darwin-aarch64";

export function getStandardZipFileName(pluginName: string, platform: Platform) {
  switch (platform) {
    case "darwin-aarch64":
      return `${pluginName}-aarch64-apple-darwin.zip`;
    case "darwin-x86_64":
      return `${pluginName}-x86_64-apple-darwin.zip`;
    case "linux-x86_64":
      return `${pluginName}-x86_64-unknown-linux-gnu.zip`;
    case "windows-x86_64":
      return `${pluginName}-x86_64-pc-windows-msvc.zip`;
  }
}

export function getCurrentPlatform() {
  return `${Deno.build.os}-x86_64` as const;
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
