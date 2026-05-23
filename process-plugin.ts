import { getChecksum } from "./hash.ts";

export type Platform =
  | "darwin-x86_64"
  | "darwin-aarch64"
  | "linux-x86_64"
  | "linux-x86_64-musl"
  | "linux-aarch64"
  | "linux-aarch64-musl"
  | "linux-riscv64"
  | "linux-riscv64-musl"
  | "linux-loongarch64"
  | "windows-x86_64"
  | "windows-aarch64";

export function getStandardZipFileName(pluginName: string, platform: Platform): string {
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
    case "linux-riscv64":
      return `${pluginName}-riscv64gc-unknown-linux-gnu.zip`;
    case "linux-riscv64-musl":
      return `${pluginName}-riscv64gc-unknown-linux-musl.zip`;
    case "linux-loongarch64":
      return `${pluginName}-loongarch64-unknown-linux-gnu.zip`;
    case "windows-x86_64":
      return `${pluginName}-x86_64-pc-windows-msvc.zip`;
    case "windows-aarch64":
      return `${pluginName}-aarch64-pc-windows-msvc.zip`;
    default: {
      const _never: never = platform;
      throw new Error(`Not supported platform: ${platform}`);
    }
  }
}

export function getCurrentPlatform():
  | "darwin-x86_64"
  | "darwin-aarch64"
  | "linux-x86_64"
  | "linux-aarch64"
  | "windows-x86_64"
  | "windows-aarch64"
{
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

  get pluginName(): string {
    return this.#output.name as string;
  }

  get version(): string {
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

  outputTextChecksum(): Promise<string> {
    const text = this.outputText();
    return getChecksum(new TextEncoder().encode(text));
  }

  outputText(): string {
    return JSON.stringify(this.#output, undefined, 2) + "\n";
  }
}

/** Options for {@link createDprintOrgNpmPackages}. */
export interface CreateDprintOrgNpmPackagesOptions {
  /** Name of the plugin as it appears in `plugin.json` (matches Cargo.toml). */
  pluginName: string;
  /** Version of the plugin. */
  version: string;
  /**
   * The npm package name for the main package (may be scoped,
   * e.g. `@dprint/exec`). Per-platform sub-packages are named
   * `<mainPackageName>-<platform>`.
   */
  mainPackageName: string;
  /** Per-platform zips that will be packed as sub-packages. */
  platforms: { platform: Platform; zipFilePath: string }[];
  /** Directory in which to write the package subdirectories. */
  outDir: string;
  /**
   * Extra fields merged into every generated `package.json`. The fields
   * `name`, `version`, `os`, `cpu`, `libc`, and `optionalDependencies` are
   * always set by this function and override any value provided here.
   */
  packageJsonExtra?: Record<string, unknown>;
}

/** Result of {@link createDprintOrgNpmPackages}. */
export interface CreateDprintOrgNpmPackagesResult {
  /** Directory containing the main package (run `npm publish` here last). */
  mainPackageDir: string;
  /**
   * Directories containing the per-platform sub-packages. Publish these
   * before the main package so its `optionalDependencies` resolve.
   */
  subPackageDirs: string[];
}

/**
 * Creates the npm package directory structure for a dprint-org process plugin.
 *
 * For each platform it writes `<outDir>/<basename>-<platform>/`
 * containing `package.json` (with `os`/`cpu`/`libc` filters) and `plugin.zip`.
 * It also writes the main package at `<outDir>/<basename>/` whose
 * `plugin.json` references each sub-package via
 * `npm:<sub-package>@<version>/plugin.zip` and whose `package.json` lists
 * every sub-package as an `optionalDependencies` entry pinned to `version`.
 *
 * `basename` is the last `/`-separated segment of `mainPackageName`
 * (e.g. `@dprint/exec` → `exec`).
 *
 * The caller is expected to `npm publish` each sub-package directory first,
 * then the main package directory.
 */
export async function createDprintOrgNpmPackages(
  options: CreateDprintOrgNpmPackagesOptions,
): Promise<CreateDprintOrgNpmPackagesResult> {
  const builder = new PluginFileBuilder({
    name: options.pluginName,
    version: options.version,
  });

  await Deno.mkdir(options.outDir, { recursive: true });

  const basename = packageBasename(options.mainPackageName);
  const subPackageDirs: string[] = [];
  const optionalDependencies: Record<string, string> = {};

  for (const { platform, zipFilePath } of options.platforms) {
    const subPackageName = `${options.mainPackageName}-${platform}`;
    const subPackageDir = `${options.outDir}/${basename}-${platform}`;
    await Deno.mkdir(subPackageDir, { recursive: true });
    await Deno.copyFile(zipFilePath, `${subPackageDir}/plugin.zip`);
    await writeJsonFile(`${subPackageDir}/package.json`, {
      ...options.packageJsonExtra,
      name: subPackageName,
      version: options.version,
      ...npmPlatformFilters(platform),
    });
    subPackageDirs.push(subPackageDir);
    optionalDependencies[subPackageName] = options.version;

    await builder.addPlatform({
      platform,
      zipFilePath,
      zipUrl: `npm:${subPackageName}@${options.version}/plugin.zip`,
    });
  }

  const mainPackageDir = `${options.outDir}/${basename}`;
  await Deno.mkdir(mainPackageDir, { recursive: true });
  await builder.writeToPath(`${mainPackageDir}/plugin.json`);
  await writeJsonFile(`${mainPackageDir}/package.json`, {
    ...options.packageJsonExtra,
    name: options.mainPackageName,
    version: options.version,
    optionalDependencies,
  });

  return { mainPackageDir, subPackageDirs };
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
    const zipUrl = `https://plugins.dprint.dev/dprint/${pluginName}/${builder.version}/asset/${zipFileName}`;
    await builder.addPlatform({
      platform,
      zipFilePath: zipFileName,
      zipUrl,
    });
  }
}

function packageBasename(npmName: string): string {
  const slashIdx = npmName.lastIndexOf("/");
  return slashIdx >= 0 ? npmName.substring(slashIdx + 1) : npmName;
}

function npmPlatformFilters(
  platform: Platform,
): { os: string[]; cpu: string[]; libc?: string[] } {
  switch (platform) {
    case "darwin-x86_64":
      return { os: ["darwin"], cpu: ["x64"] };
    case "darwin-aarch64":
      return { os: ["darwin"], cpu: ["arm64"] };
    case "linux-x86_64":
      return { os: ["linux"], cpu: ["x64"], libc: ["glibc"] };
    case "linux-x86_64-musl":
      return { os: ["linux"], cpu: ["x64"], libc: ["musl"] };
    case "linux-aarch64":
      return { os: ["linux"], cpu: ["arm64"], libc: ["glibc"] };
    case "linux-aarch64-musl":
      return { os: ["linux"], cpu: ["arm64"], libc: ["musl"] };
    case "linux-riscv64":
      return { os: ["linux"], cpu: ["riscv64"], libc: ["glibc"] };
    case "linux-riscv64-musl":
      return { os: ["linux"], cpu: ["riscv64"], libc: ["musl"] };
    case "linux-loongarch64":
      return { os: ["linux"], cpu: ["loong64"] };
    case "windows-x86_64":
      return { os: ["win32"], cpu: ["x64"] };
    case "windows-aarch64":
      return { os: ["win32"], cpu: ["arm64"] };
    default: {
      const _never: never = platform;
      throw new Error(`Not supported platform: ${platform}`);
    }
  }
}

async function writeJsonFile(filePath: string, value: unknown): Promise<void> {
  await Deno.writeTextFile(filePath, JSON.stringify(value, undefined, 2) + "\n");
}
