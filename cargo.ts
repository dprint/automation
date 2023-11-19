import type { dax } from "./deps.ts";
import { semver } from "./deps.ts";

export class CargoToml {
  #path: dax.PathRef;
  #text: string;

  static versionRegex = /^version\s*=\s*\"(\d+\.\d+\.\d+)\"$/m;

  constructor(path: dax.PathRef) {
    this.#path = path;
    this.#text = path.readTextSync();
  }

  bumpCargoTomlVersion(kind: "minor" | "patch") {
    const currentVersion = this.version();
    const newVersion = semver.format(semver.increment(semver.parse(currentVersion), kind));
    this.#text = this.#text.replace(CargoToml.versionRegex, `version = "${newVersion}"`);
  }

  version() {
    const currentVersion = extractCargoVersionFromText(this.#text);
    if (currentVersion == null) {
      throw new Error("Could not find version.");
    }
    return currentVersion;
  }

  setVersion(version: string) {
    const newText = this.#text.replace(/^version\s*=\s*\"(\d+\.\d+\.\d+)\"$/m, `version = "${version}"`);
    if (extractCargoVersionFromText(newText) !== version) {
      console.error("File text");
      console.error("=========");
      console.error(newText);
      console.error("=========");
      throw new Error(`Version didn't seem to be set properly.`);
    }
    this.#text = newText;
  }

  save() {
    this.#path.writeTextSync(this.#text);
  }
}

function extractCargoVersionFromText(text: string) {
  return text.match(CargoToml.versionRegex)?.[1];
}
