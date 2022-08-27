// adapted from https://github.com/denoland/automation/blob/main/tasks/publish_release.ts

import { $, extractCargoVersionFromTextOrThrow, semver, setCargoVersionInText } from "../mod.ts";

const cliArgs = getCliArgs();

$.logStep("Retrieving current Cargo.toml version...");
const cwd = $.path.resolve(".");
const cargoTomlFilePath = $.path.join(cwd, cliArgs.cargoTomlPath);
const cargoTomlText = await Deno.readTextFile(cargoTomlFilePath);
const currentVersion = extractCargoVersionFromTextOrThrow(cargoTomlText);
const newVersion = semver.parse(currentVersion)!.inc(cliArgs.kind).toString();

$.logStep(`Setting new version to ${newVersion}...`);
await Deno.writeTextFile(cargoTomlFilePath, setCargoVersionInText(cargoTomlText, newVersion));

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

interface CliArgs {
  kind: "major" | "minor" | "patch";
  cargoTomlPath: string;
}

function getCliArgs() {
  const args: CliArgs = {
    kind: "patch",
    cargoTomlPath: "./Cargo.toml",
  };

  for (const arg of Deno.args) {
    if (arg === "--major") {
      args.kind = "major";
    } else if (arg === "--minor") {
      args.kind = "minor";
    } else if (arg === "--patch") {
      args.kind = "patch";
    } else if (arg.startsWith("--")) {
      throw new Error(`Invalid argument: ${arg}`);
    } else if (args.cargoTomlPath == null) {
      args.cargoTomlPath = arg;
    } else {
      throw new Error(`Invalid arguments: ${Deno.args.join(" ")}`);
    }
  }
  return args;
}
