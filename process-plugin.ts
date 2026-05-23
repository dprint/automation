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
  | "linux-loongarch64-musl"
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
    case "linux-loongarch64-musl":
      return `${pluginName}-loongarch64-unknown-linux-musl.zip`;
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
   * e.g. `@dprint/exec`).
   */
  mainPackageName: string;
  /**
   * Prefix prepended to each platform suffix to form a sub-package name.
   * Defaults to `${mainPackageName}-`, producing names like
   * `@dprint/exec-linux-x64-glibc`.
   *
   * Pass e.g. `"@dprint/"` to produce names like `@dprint/linux-x64-glibc`
   * (the convention used by the dprint CLI itself, where sub-packages share
   * the scope but not the basename of the main package).
   */
  subPackagePrefix?: string;
  /**
   * Per-platform binaries that will be packed as sub-packages. Each
   * `binaryPath` points to the raw executable on disk — it's copied
   * into the sub-package under its basename, and the main package's
   * `plugin.json` references it via `npm:<sub>@<version>/<basename>`.
   * On Unix, the copied file is marked executable (mode 0o755).
   */
  platforms: { platform: Platform; binaryPath: string }[];
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
 * For each platform it writes
 * `<outDir>/<sub-package-basename>/{package.json, <binary>}`, where `<binary>`
 * is the basename of the input `binaryPath` (e.g. `dprint-plugin-exec` or
 * `dprint-plugin-exec.exe`). The binary is copied as-is and marked executable
 * (mode 0o755) on Unix. Sub-package `package.json` files carry `os`/`cpu`/`libc`
 * filters using Node's canonical values (e.g. `linux` / `x64` / `glibc`) so
 * npm only installs the matching one. The platform suffix matches the
 * convention used by the dprint CLI: `darwin-x64`, `darwin-arm64`,
 * `linux-x64-glibc`, `linux-x64-musl`, `linux-arm64-glibc`,
 * `linux-arm64-musl`, `linux-riscv64-glibc`, `linux-riscv64-musl`,
 * `linux-loong64-glibc`, `linux-loong64-musl`, `win32-x64`, `win32-arm64`.
 *
 * It also writes the main package at
 * `<outDir>/<main-package-basename>/{package.json, plugin.json}`. The
 * `plugin.json` references each sub-package via
 * `npm:<sub-package>@<version>/<binary>` and the `package.json` lists every
 * sub-package as an `optionalDependencies` entry pinned to `version`.
 *
 * `basename` here is the last `/`-separated segment of the package name (e.g.
 * `@dprint/exec` → `exec`).
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

  const subPackagePrefix = options.subPackagePrefix ?? `${options.mainPackageName}-`;
  const subPackageDirs: string[] = [];
  const optionalDependencies: Record<string, string> = {};

  for (const { platform, binaryPath } of options.platforms) {
    const info = npmPlatformInfo(platform);
    const subPackageName = `${subPackagePrefix}${info.suffix}`;
    const subPackageDir = `${options.outDir}/${packageBasename(subPackageName)}`;
    const binaryName = basenameOf(binaryPath);
    const destBinaryPath = `${subPackageDir}/${binaryName}`;

    await Deno.mkdir(subPackageDir, { recursive: true });
    await Deno.copyFile(binaryPath, destBinaryPath);
    // mark the destination executable on Unix; no-op on Windows (the platform
    // has no concept and Deno.chmod throws there).
    if (Deno.build.os !== "windows") {
      await Deno.chmod(destBinaryPath, 0o755);
    }
    await writeSubPackageJson(`${subPackageDir}/package.json`, {
      name: subPackageName,
      version: options.version,
      extra: options.packageJsonExtra,
      os: info.os,
      cpu: info.cpu,
      libc: info.libc,
    });
    subPackageDirs.push(subPackageDir);
    optionalDependencies[subPackageName] = options.version;

    await builder.addPlatform({
      platform,
      zipFilePath: binaryPath,
      zipUrl: `npm:${subPackageName}@${options.version}/${binaryName}`,
    });
  }

  const mainPackageDir = `${options.outDir}/${packageBasename(options.mainPackageName)}`;
  await Deno.mkdir(mainPackageDir, { recursive: true });
  await builder.writeToPath(`${mainPackageDir}/plugin.json`);
  await writeMainPackageJson(`${mainPackageDir}/package.json`, {
    name: options.mainPackageName,
    version: options.version,
    extra: options.packageJsonExtra,
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

interface NpmPlatformInfo {
  /** Package-name suffix matching the dprint CLI convention. */
  suffix: string;
  /** Value of the npm `os` field. */
  os: string[];
  /** Value of the npm `cpu` field. */
  cpu: string[];
  /** Value of the npm `libc` field (omitted on darwin/win32). */
  libc?: string[];
}

function npmPlatformInfo(platform: Platform): NpmPlatformInfo {
  switch (platform) {
    case "darwin-x86_64":
      return { suffix: "darwin-x64", os: ["darwin"], cpu: ["x64"] };
    case "darwin-aarch64":
      return { suffix: "darwin-arm64", os: ["darwin"], cpu: ["arm64"] };
    case "linux-x86_64":
      return { suffix: "linux-x64-glibc", os: ["linux"], cpu: ["x64"], libc: ["glibc"] };
    case "linux-x86_64-musl":
      return { suffix: "linux-x64-musl", os: ["linux"], cpu: ["x64"], libc: ["musl"] };
    case "linux-aarch64":
      return { suffix: "linux-arm64-glibc", os: ["linux"], cpu: ["arm64"], libc: ["glibc"] };
    case "linux-aarch64-musl":
      return { suffix: "linux-arm64-musl", os: ["linux"], cpu: ["arm64"], libc: ["musl"] };
    case "linux-riscv64":
      return { suffix: "linux-riscv64-glibc", os: ["linux"], cpu: ["riscv64"], libc: ["glibc"] };
    case "linux-riscv64-musl":
      return { suffix: "linux-riscv64-musl", os: ["linux"], cpu: ["riscv64"], libc: ["musl"] };
    case "linux-loongarch64":
      return { suffix: "linux-loong64-glibc", os: ["linux"], cpu: ["loong64"], libc: ["glibc"] };
    case "linux-loongarch64-musl":
      return { suffix: "linux-loong64-musl", os: ["linux"], cpu: ["loong64"], libc: ["musl"] };
    case "windows-x86_64":
      return { suffix: "win32-x64", os: ["win32"], cpu: ["x64"] };
    case "windows-aarch64":
      return { suffix: "win32-arm64", os: ["win32"], cpu: ["arm64"] };
    default: {
      const _never: never = platform;
      throw new Error(`Not supported platform: ${platform}`);
    }
  }
}

async function writeSubPackageJson(
  filePath: string,
  fields: {
    name: string;
    version: string;
    extra: Record<string, unknown> | undefined;
    os: string[];
    cpu: string[];
    libc: string[] | undefined;
  },
): Promise<void> {
  await writeJsonFile(
    filePath,
    buildPackageJson(
      { name: fields.name, version: fields.version },
      fields.extra,
      { os: fields.os, cpu: fields.cpu, libc: fields.libc },
    ),
  );
}

async function writeMainPackageJson(
  filePath: string,
  fields: {
    name: string;
    version: string;
    extra: Record<string, unknown> | undefined;
    optionalDependencies: Record<string, string>;
  },
): Promise<void> {
  await writeJsonFile(
    filePath,
    buildPackageJson(
      { name: fields.name, version: fields.version },
      fields.extra,
      { optionalDependencies: fields.optionalDependencies },
    ),
  );
}

/**
 * Builds a package.json object with `name` and `version` at the top, then
 * the caller-supplied extras, then any trailing managed fields (os, cpu,
 * libc, optionalDependencies). Extras' attempts to override managed fields
 * are silently dropped.
 */
function buildPackageJson(
  head: { name: string; version: string },
  extra: Record<string, unknown> | undefined,
  trailing: Record<string, unknown>,
): Record<string, unknown> {
  const managedKeys = new Set([
    "name",
    "version",
    ...Object.keys(trailing),
  ]);
  const result: Record<string, unknown> = {
    name: head.name,
    version: head.version,
  };
  if (extra != null) {
    for (const [k, v] of Object.entries(extra)) {
      if (managedKeys.has(k)) continue;
      result[k] = v;
    }
  }
  for (const [k, v] of Object.entries(trailing)) {
    // undefined values are dropped by JSON.stringify, so this still
    // suppresses e.g. `libc` on platforms that don't need it.
    result[k] = v;
  }
  return result;
}

async function writeJsonFile(filePath: string, value: unknown): Promise<void> {
  await Deno.writeTextFile(filePath, JSON.stringify(value, undefined, 2) + "\n");
}

function basenameOf(path: string): string {
  // accept both / and \ for cross-platform input paths
  const slash = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return slash >= 0 ? path.substring(slash + 1) : path;
}
