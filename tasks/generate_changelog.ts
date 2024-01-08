import { $, semver } from "../deps.ts";

const firstArg = Deno.args[0];
if (!isVersion(firstArg)) {
  $.logError("Error First argument must be a valid semver version.");
  Deno.exit(1);
}
const newVersion = semver.parse(firstArg);

// fetch git tags
$.logStep("Fetching git tags...");
await $`git fetch origin --tags --recurse-submodules=no`;

// current tags
$.logStep("Finding past version...");
const gitTags = await $`git tag`.lines();
const versions = gitTags
  .filter(tag => isVersion(tag))
  .map(tag => semver.parse(tag));
const pastVersion = versions.filter(version => semver.gt(newVersion, version)).sort(semver.rcompare)[0];
if (pastVersion == null) {
  $.logError("Error Could not find a past version.");
  $.log("Versions:", versions.join(", "));
  Deno.exit(1);
}
$.logLight("  Past version:", semver.format(pastVersion));

$.logStep("Fetching git log...");
await gitFetchUntilTag(semver.format(pastVersion));

// create change log
$.logStep("Creating change log...");
const changeLog = await getChangeLog();
console.log(changeLog);

function isVersion(tag: string) {
  try {
    semver.parse(tag);
    return true;
  } catch {
    return false;
  }
}

async function getChangeLog() {
  return formatGitLogOutput(await fetchGitLogLines());
}

async function fetchGitLogLines() {
  const revs = await $`git rev-list ${semver.format(pastVersion)}..${semver.format(newVersion)}`.lines();
  return await Promise.all(revs.map(async rev => {
    const message = await $`git log --format=%s -n 1 ${rev}`.text();
    return { rev, message };
  }));
}

async function gitFetchUntilTag(tag: string) {
  if (await gitIsShallow()) {
    await gitFetchUntil(tag);
  } else {
    await $`git fetch origin --recurse-submodules=no ${tag}`;
  }
}

async function gitIsShallow() {
  const output = await $`git rev-parse --is-shallow-repository`.text();
  return output === "true";
}

async function gitFetchUntil(revision: string) {
  await $`git fetch origin --shallow-exclude=${revision}`;
}

// Code below is Copyright 2018-2023 the Deno authors. All rights reserved. MIT license.
// https://github.com/denoland/automation/blob/c427dafbb747ca4e27149306376aa0d1b71bda78/helpers.ts
function formatGitLogOutput(lines: {
  rev: string;
  message: string;
}[]) {
  const IGNORED_COMMIT_PREFIX = [
    "bench",
    "build",
    "chore",
    "ci",
    "cleanup",
    "docs",
    "refactor",
    "test",
  ];
  return lines
    .filter((l) => {
      // don't include version commits
      if (/^v?[0-9]+\.[0-9]+\.[0-9]+/.test(l.message)) {
        return false;
      }

      return !IGNORED_COMMIT_PREFIX
        .some((prefix) => l.message.startsWith(prefix))
        && l.message.length > 0;
    })
    .map((line) => `- ${line.message}`)
    .sort()
    .join("\n");
}
