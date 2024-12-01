import type { dax } from "./deps.ts";
import { semver } from "./deps.ts";

export class CargoToml {
  #path: dax.Path;
  #text: string;

  static versionRegex = /^version\s*=\s*\"(\d+\.\d+\.\d+)\"$/m;

  constructor(path: dax.Path) {
    this.#path = path;
    this.#text = path.readTextSync();
  }

  text() {
    return this.#text;
  }

  setText(text: string) {
    this.#text = text;
    const temp = this.#path.withExtname(".tmp");
    temp.writeTextSync(this.#text);
    temp.renameSync(this.#path);
  }

  bumpCargoTomlVersion(kind: "major" | "minor" | "patch") {
    const currentVersion = this.version();
    const newVersion = semver.format(semver.increment(semver.parse(currentVersion), kind));
    this.setText(this.#text.replace(CargoToml.versionRegex, `version = "${newVersion}"`));
  }

  replaceAll(from: string, to: string) {
    this.setText(this.#text.replaceAll(from, to));
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
    this.setText(newText);
  }
}

function extractCargoVersionFromText(text: string) {
  return text.match(CargoToml.versionRegex)?.[1];
}
