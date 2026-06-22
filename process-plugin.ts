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
  | "linux-powerpc64le"
  | "linux-powerpc64le-musl"
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
    case "linux-powerpc64le":
      return `${pluginName}-powerpc64le-unknown-linux-gnu.zip`;
    case "linux-powerpc64le-musl":
      return `${pluginName}-powerpc64le-unknown-linux-musl.zip`;
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

  /**
   * Adds a platform entry with a precomputed checksum. Use this when the
   * checksum doesn't correspond to a single file on disk (e.g. it covers
   * a npm tarball that has already been packed and hashed).
   */
  addPlatformEntry(options: { platform: Platform; reference: string; checksum: string }) {
    this.#output[options.platform] = {
      "reference": options.reference,
      "checksum": options.checksum,
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
   *
   * For plugins whose executable can't run standalone (e.g. self-contained
   * .NET apps that ship with side-loaded DLLs), set `packageContents` to
   * the directory whose contents should be copied into the sub-package.
   * `binaryPath` must be a file inside that directory; everything else in
   * the directory is copied verbatim, preserving relative paths.
   */
  platforms: {
    platform: Platform;
    binaryPath: string;
    packageContents?: string;
  }[];
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
  /** Directory containing the main package. */
  mainPackageDir: string;
  /**
   * Tarball for the main package. Publish this last with
   * `npm publish <path>` so npm uploads the exact bytes whose hash users
   * verify, rather than re-packing and risking a hash mismatch.
   */
  mainPackageTarball: string;
  /** Directories containing the per-platform sub-packages. */
  subPackageDirs: string[];
  /**
   * Tarballs for each per-platform sub-package, in the same order as
   * {@link subPackageDirs}. The SHA-256 of each tarball is the value
   * stored in the main package's `plugin.json` per-platform `checksum`
   * field, so publishing the same tarball ensures dprint's verification
   * succeeds. Publish these before {@link mainPackageTarball}.
   */
  subPackageTarballs: string[];
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
 * `linux-loong64-glibc`, `linux-loong64-musl`, `linux-ppc64-glibc`,
 * `linux-ppc64-musl`, `win32-x64`, `win32-arm64`.
 *
 * After each sub-package dir is written, `npm pack` is run inside it to
 * produce a `.tgz` next to the dir; the SHA-256 of that tarball becomes
 * the per-platform `checksum` in the main package's `plugin.json` —
 * matching dprint's per-platform tarball-hash verification.
 *
 * Finally the main package is written to
 * `<outDir>/<main-package-basename>/{package.json, plugin.json}` and packed
 * the same way. The `plugin.json` references each sub-package via
 * `npm:<sub-package>@<version>/<binary>` and the `package.json` lists every
 * sub-package as an `optionalDependencies` entry pinned to `version`.
 *
 * `basename` here is the last `/`-separated segment of the package name (e.g.
 * `@dprint/exec` → `exec`).
 *
 * The caller is expected to `npm publish <tarball>` each sub-package
 * tarball first, then the main package tarball. Publishing the tarballs
 * (rather than the directories) guarantees the published bytes match
 * what was hashed.
 *
 * `npm` must be on `PATH` when calling this function.
 */
export async function createDprintOrgNpmPackages(
  options: CreateDprintOrgNpmPackagesOptions,
): Promise<CreateDprintOrgNpmPackagesResult> {
  await Deno.mkdir(options.outDir, { recursive: true });

  const subPackagePrefix = options.subPackagePrefix ?? `${options.mainPackageName}-`;
  const subPackageDirs: string[] = [];
  const subPackageTarballs: string[] = [];
  const optionalDependencies: Record<string, string> = {};

  // pass 1: write each sub-package directory.
  interface PendingSubPackage {
    platform: Platform;
    subPackageName: string;
    subPackageDir: string;
    binaryName: string;
  }
  const pending: PendingSubPackage[] = [];

  for (const { platform, binaryPath, packageContents } of options.platforms) {
    const info = npmPlatformInfo(platform);
    const subPackageName = `${subPackagePrefix}${info.suffix}`;
    const subPackageDir = `${options.outDir}/${packageBasename(subPackageName)}`;
    const binaryName = basenameOf(binaryPath);
    const destBinaryPath = `${subPackageDir}/${binaryName}`;

    await Deno.mkdir(subPackageDir, { recursive: true });
    if (packageContents != null) {
      const binaryRelInDir = relativePathInside(packageContents, binaryPath);
      if (binaryRelInDir == null) {
        throw new Error(
          `binaryPath ${binaryPath} must be inside packageContents ${packageContents}`,
        );
      }
      await copyDirContents(packageContents, subPackageDir);
    } else {
      await Deno.copyFile(binaryPath, destBinaryPath);
    }
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
    pending.push({ platform, subPackageName, subPackageDir, binaryName });
  }

  // pass 2: npm pack each sub-package and hash its tarball.
  const builder = new PluginFileBuilder({
    name: options.pluginName,
    version: options.version,
  });
  for (const { platform, subPackageName, subPackageDir, binaryName } of pending) {
    const tarball = await npmPack(subPackageDir, options.outDir);
    subPackageTarballs.push(tarball);
    const checksum = await getChecksum(await Deno.readFile(tarball));
    console.log(`${tarball}: ${checksum}`);
    builder.addPlatformEntry({
      platform,
      reference: `npm:${subPackageName}@${options.version}/${binaryName}`,
      checksum,
    });
  }

  // pass 3: write the main package, then pack it.
  const mainPackageDir = `${options.outDir}/${packageBasename(options.mainPackageName)}`;
  await Deno.mkdir(mainPackageDir, { recursive: true });
  await builder.writeToPath(`${mainPackageDir}/plugin.json`);
  await writeMainPackageJson(`${mainPackageDir}/package.json`, {
    name: options.mainPackageName,
    version: options.version,
    extra: options.packageJsonExtra,
    optionalDependencies,
  });
  const mainPackageTarball = await npmPack(mainPackageDir, options.outDir);

  return { mainPackageDir, mainPackageTarball, subPackageDirs, subPackageTarballs };
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
    case "linux-powerpc64le":
      return { suffix: "linux-ppc64-glibc", os: ["linux"], cpu: ["ppc64"], libc: ["glibc"] };
    case "linux-powerpc64le-musl":
      return { suffix: "linux-ppc64-musl", os: ["linux"], cpu: ["ppc64"], libc: ["musl"] };
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

/**
 * Runs `npm pack` against `packageDir` and writes the tarball into
 * `destDir`. Returns the absolute path to the .tgz. Requires `npm` on PATH.
 */
async function npmPack(packageDir: string, destDir: string): Promise<string> {
  const out = await new Deno.Command("npm", {
    args: ["pack", "--json", "--pack-destination", destDir, packageDir],
    stdout: "piped",
    stderr: "piped",
  }).output().catch((err: unknown) => {
    if (err instanceof Deno.errors.NotFound) {
      throw new Error("createDprintOrgNpmPackages requires `npm` on PATH (used for `npm pack`).");
    }
    throw err;
  });
  if (!out.success) {
    throw new Error(
      `npm pack failed for ${packageDir}:\n${new TextDecoder().decode(out.stderr)}`,
    );
  }
  const parsed = JSON.parse(new TextDecoder().decode(out.stdout)) as Array<{
    filename: string;
  }>;
  if (parsed.length !== 1 || !parsed[0].filename) {
    throw new Error(`Unexpected npm pack JSON output for ${packageDir}: ${new TextDecoder().decode(out.stdout)}`);
  }
  return `${destDir}/${parsed[0].filename}`;
}

function basenameOf(path: string): string {
  // accept both / and \ for cross-platform input paths
  const slash = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return slash >= 0 ? path.substring(slash + 1) : path;
}

/**
 * Recursively copies the contents of `src` into `dest`. `dest` must already
 * exist. Sub-directories are created as needed. File modes are preserved on
 * Unix (so e.g. a pre-existing executable bit survives the copy); on Windows
 * the OS doesn't carry modes so npm pack will record 0644.
 */
async function copyDirContents(src: string, dest: string): Promise<void> {
  for await (const entry of Deno.readDir(src)) {
    const srcPath = `${src}/${entry.name}`;
    const destPath = `${dest}/${entry.name}`;
    if (entry.isDirectory) {
      await Deno.mkdir(destPath, { recursive: true });
      await copyDirContents(srcPath, destPath);
    } else {
      await Deno.copyFile(srcPath, destPath);
    }
  }
}

/**
 * Returns `child` expressed relative to `parent` using forward slashes, or
 * `null` if `child` is not inside `parent`. Both paths are normalized to use
 * forward slashes first so this works regardless of input separator style.
 */
function relativePathInside(parent: string, child: string): string | null {
  const p = normalizeSlashes(parent).replace(/\/+$/, "") + "/";
  const c = normalizeSlashes(child);
  if (!c.startsWith(p)) return null;
  return c.substring(p.length);
}

function normalizeSlashes(path: string): string {
  return path.replaceAll("\\", "/");
}
