import { assertEquals } from "@std/assert";
import { findLatestCrateVersion, getCrateIndexUrl, parseCrateIndex } from "./crates.ts";

Deno.test("getCrateIndexUrl uses the index's directory layout", () => {
  assertEquals(getCrateIndexUrl("a"), "https://index.crates.io/1/a");
  assertEquals(getCrateIndexUrl("ab"), "https://index.crates.io/2/ab");
  assertEquals(getCrateIndexUrl("abc"), "https://index.crates.io/3/a/abc");
  assertEquals(getCrateIndexUrl("abcd"), "https://index.crates.io/ab/cd/abcd");
  assertEquals(getCrateIndexUrl("Mago-Formatter"), "https://index.crates.io/ma/go/mago-formatter");
});

Deno.test("parseCrateIndex reads a version from each line", () => {
  const text = [
    `{"name":"example","vers":"1.0.0","deps":[],"yanked":false}`,
    `{"name":"example","vers":"1.1.0","deps":[],"yanked":true,"rust_version":"1.89"}`,
    `{"name":"example","vers":"1.2.0","deps":[],"yanked":false,"rust_version":null}`,
    "",
  ].join("\n");
  assertEquals(parseCrateIndex(text), [
    { version: "1.0.0", yanked: false, rustVersion: undefined },
    { version: "1.1.0", yanked: true, rustVersion: "1.89" },
    { version: "1.2.0", yanked: false, rustVersion: undefined },
  ]);
});

Deno.test("findLatestCrateVersion skips yanked and pre-release versions", () => {
  const versions = ["1.2.0", "1.10.0", "1.9.0", "1.11.0", "2.0.0-beta.1"].map((version) => ({
    version,
    yanked: version === "1.11.0",
    rustVersion: undefined,
  }));
  assertEquals(findLatestCrateVersion(versions)?.version, "1.10.0");
  assertEquals(findLatestCrateVersion([]), undefined);
});
