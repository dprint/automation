import type * as dax from "dax";
import * as semver from "semver";

export class CargoToml {
  #path: dax.Path;
  #text: string;

  static versionRegex = /^version\s*=\s*\"(\d+\.\d+\.\d+)\"$/m;

  constructor(path: dax.Path) {
    this.#path = path;
    this.#text = path.readTextSync();
  }

  text(): string {
    return this.#text;
  }

  setText(text: string) {
    this.#text = text;
    writeTextAtomic(this.#path, this.#text);
  }

  /**
   * Bumps the crate's version, along with its entry in the `Cargo.lock`.
   */
  bumpCargoTomlVersion(kind: "major" | "minor" | "patch") {
    const currentVersion = this.version();
    const newVersion = semver.format(semver.increment(semver.parse(currentVersion), kind));
    this.setVersion(newVersion);
  }

  replaceAll(from: string, to: string) {
    this.setText(this.#text.replaceAll(from, to));
  }

  version(): string {
    const currentVersion = extractCargoVersionFromText(this.#text);
    if (currentVersion == null) {
      throw new Error("Could not find version.");
    }
    return currentVersion;
  }

  /**
   * Sets the crate's version, along with its entry in the `Cargo.lock`.
   *
   * The lockfile is updated here because cargo only updates it on the next build,
   * so committing the version bump on its own would leave the lockfile behind.
   */
  setVersion(version: string) {
    const currentVersion = this.version();
    const newText = this.#text.replace(/^version\s*=\s*\"(\d+\.\d+\.\d+)\"$/m, `version = "${version}"`);
    if (extractCargoVersionFromText(newText) !== version) {
      console.error("File text");
      console.error("=========");
      console.error(newText);
      console.error("=========");
      throw new Error(`Version didn't seem to be set properly.`);
    }
    this.setText(newText);
    this.#setLockfileVersion(currentVersion, version);
  }

  #setLockfileVersion(fromVersion: string, toVersion: string) {
    const name = extractPackageNameFromText(this.#text);
    const lockfilePath = name == null ? undefined : findLockfile(this.#path);
    if (name == null || lockfilePath == null) {
      return;
    }
    const text = lockfilePath.readTextSync();
    // only the crate's own entry, not a dependency that happens to have the same version
    const entryRegex = new RegExp(
      `(\\[\\[package\\]\\]\\r?\\nname = "${escapeRegExp(name)}"\\r?\\nversion = ")${escapeRegExp(fromVersion)}(")`,
    );
    const newText = text.replace(entryRegex, (_match, start, end) => `${start}${toVersion}${end}`);
    if (newText !== text) {
      writeTextAtomic(lockfilePath, newText);
    }
  }
}

function extractPackageNameFromText(text: string) {
  // the sections of the file split at each table header (ex. `[package]`)
  const packageSection = text.split(/^\[/m).find((section) => section.startsWith("package]"));
  return packageSection?.match(/^name\s*=\s*"([^"]+)"\s*$/m)?.[1];
}

/** Finds the `Cargo.lock` in the crate's directory or the closest one above it (ex. a workspace root). */
function findLockfile(cargoTomlPath: dax.Path) {
  let dir: dax.Path | undefined = cargoTomlPath.parent();
  while (dir != null) {
    const lockfilePath = dir.join("Cargo.lock");
    if (lockfilePath.existsSync()) {
      return lockfilePath;
    }
    dir = dir.parent();
  }
  return undefined;
}

function writeTextAtomic(path: dax.Path, text: string) {
  const temp = path.withExtname(".tmp");
  temp.writeTextSync(text);
  temp.renameSync(path);
}

function escapeRegExp(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function extractCargoVersionFromText(text: string) {
  return text.match(CargoToml.versionRegex)?.[1];
}
