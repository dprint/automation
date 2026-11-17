import $ from "dax";
import * as semver from "semver";

/** A published version of a crate. */
export interface CrateVersion {
  version: string;
  yanked: boolean;
  /** The minimum Rust version the crate declares (ex. `1.89`), if any. */
  rustVersion: string | undefined;
}

/**
 * Gets the highest version of a crate that isn't yanked or a pre-release.
 *
 * This reads the sparse index rather than the crates.io API because the API
 * is rate limited by IP address, which fails on CI runners that share one.
 */
export async function getLatestCrateVersion(crateName: string): Promise<CrateVersion> {
  const latest = findLatestCrateVersion(await getCrateVersions(crateName));
  if (latest == null) {
    throw new Error(`Could not find a stable version of ${crateName} in the crates.io index.`);
  }
  return latest;
}

/** Gets every published version of a crate from the crates.io sparse index. */
export async function getCrateVersions(crateName: string): Promise<CrateVersion[]> {
  const text = await $.request(getCrateIndexUrl(crateName)).text();
  return parseCrateIndex(text);
}

/** Gets the highest of the versions that isn't yanked or a pre-release. */
export function findLatestCrateVersion(versions: CrateVersion[]): CrateVersion | undefined {
  let latest: { parsed: semver.SemVer; version: CrateVersion } | undefined;
  for (const version of versions) {
    if (version.yanked) {
      continue;
    }
    const parsed = semver.parse(version.version);
    if (parsed.prerelease != null && parsed.prerelease.length > 0) {
      continue;
    }
    if (latest == null || semver.greaterThan(parsed, latest.parsed)) {
      latest = { parsed, version };
    }
  }
  return latest?.version;
}

/** Gets the url of a crate's file in the crates.io sparse index. */
export function getCrateIndexUrl(crateName: string): string {
  // https://doc.rust-lang.org/cargo/reference/registry-index.html#index-files
  const name = crateName.toLowerCase();
  let path: string;
  if (name.length <= 2) {
    path = `${name.length}/${name}`;
  } else if (name.length === 3) {
    path = `3/${name[0]}/${name}`;
  } else {
    path = `${name.slice(0, 2)}/${name.slice(2, 4)}/${name}`;
  }
  return `https://index.crates.io/${path}`;
}

/** Parses a crate's file in the index, which has a line of JSON for each version. */
export function parseCrateIndex(text: string): CrateVersion[] {
  return text.split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => {
      const data = JSON.parse(line) as { vers: string; yanked?: boolean; rust_version?: string | null };
      return {
        version: data.vers,
        yanked: data.yanked ?? false,
        rustVersion: data.rust_version ?? undefined,
      };
    });
}
