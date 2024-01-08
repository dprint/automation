import { $, semver } from "./deps.ts";

export async function generateChangeLog(opts: { versionTo: string; versionFrom?: string }) {
  if (!isVersion(opts.versionTo)) {
    throw new Error("versionTo must be a valid version.");
  }
  const newVersion = semver.parse(opts.versionTo);

  // fetch git tags
  $.logStep("Fetching git tags...");
  await $`git fetch origin --tags --recurse-submodules=no`;

  // resolve past version
  const pastVersion = await getPastVersion();
  $.logLight("  Past version:", semver.format(pastVersion));

  $.logStep("Fetching git log...");
  await gitFetchUntilTag(semver.format(pastVersion));

  // create change log
  $.logStep("Creating change log...");
  return await getChangeLog();

  async function getPastVersion() {
    if (opts.versionFrom != null) {
      if (!isVersion(opts.versionFrom)) {
        throw new Error("versionFrom must be a valid version.");
      }
      return semver.parse(opts.versionFrom);
    }
    $.logStep("Finding past version...");
    const gitTags = await $`git tag`.lines();
    const versions = gitTags
      .filter(tag => isVersion(tag))
      .map(tag => semver.parse(tag))
      .sort(semver.rcompare);
    $.logLight("Versions:", versions.map(v => semver.format(v)).join(", "));
    const pastVersion = versions.filter(version => semver.gt(newVersion, version))[0];
    if (pastVersion == null) {
      throw new Error("Could not find a past version.");
    }
    return pastVersion;
  }

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
}
