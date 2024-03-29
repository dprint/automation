// adapted from https://github.com/denoland/automation/blob/main/tasks/publish_release.ts

import { $, CargoToml, semver } from "../mod.ts";

const cliArgs = getCliArgs();

$.logStep("Retrieving current Cargo.toml version...");
const cwd = $.path(".").resolve();
const cargoTomlFile = new CargoToml(cwd.join(cliArgs.cargoTomlPath));
const currentVersion = cargoTomlFile.version();
$.logLight(`  Found version: ${currentVersion}`);
const newVersion = semver.format(semver.increment(semver.parse(currentVersion), cliArgs.kind));

$.logStep(`Setting new version to ${newVersion}...`);
cargoTomlFile.setVersion(newVersion);

$.logStep(`Running cargo update...`);
await $`cargo update --workspace`;

$.logStep(`Committing to git...`);
await $`git add .`;
await $`git commit -m ${newVersion}`;

$.logStep(`Pushing to main...`);
await $`git push -u origin HEAD`;

$.logStep(`Tagging...`);
await $`git tag ${newVersion}`;
await $`git push origin ${newVersion}`;

function getCliArgs() {
  // very basic arg parsing
  let kind: "major" | "minor" | "patch" = "patch";
  let cargoTomlPath: string | undefined = undefined;

  for (const arg of Deno.args) {
    if (arg === "--major") {
      kind = "major";
    } else if (arg === "--minor") {
      kind = "minor";
    } else if (arg === "--patch") {
      kind = "patch";
    } else if (arg.startsWith("--")) {
      throw new Error(`Invalid argument: ${arg}`);
    } else if (cargoTomlPath == null) {
      cargoTomlPath = arg;
    } else {
      throw new Error(`Invalid arguments: ${Deno.args.join(" ")}`);
    }
  }
  return {
    kind,
    cargoTomlPath: cargoTomlPath ?? "./Cargo.toml",
  };
}
