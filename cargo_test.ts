import { assertEquals } from "@std/assert";
import $ from "dax";
import { CargoToml } from "./cargo.ts";

const CARGO_TOML = `[package]
name = "dprint-plugin-example"
version = "0.15.2"
edition = "2024"

[dependencies]
other = "0.15.2"
`;

const CARGO_LOCK = `version = 4

[[package]]
name = "dprint-plugin-example"
version = "0.15.2"
dependencies = [
 "other",
]

[[package]]
name = "other"
version = "0.15.2"
`;

Deno.test("bumpCargoTomlVersion updates the crate's entry in the Cargo.lock", () => {
  const dir = createTempDir();
  try {
    dir.join("Cargo.toml").writeTextSync(CARGO_TOML);
    dir.join("Cargo.lock").writeTextSync(CARGO_LOCK);

    const cargoToml = new CargoToml(dir.join("Cargo.toml"));
    cargoToml.bumpCargoTomlVersion("patch");

    assertEquals(cargoToml.version(), "0.15.3");
    assertEquals(dir.join("Cargo.toml").readTextSync(), CARGO_TOML.replace(`version = "0.15.2"`, `version = "0.15.3"`));
    // the dependency with the same version is left alone
    assertEquals(
      dir.join("Cargo.lock").readTextSync(),
      CARGO_LOCK.replace(
        `name = "dprint-plugin-example"\nversion = "0.15.2"`,
        `name = "dprint-plugin-example"\nversion = "0.15.3"`,
      ),
    );
  } finally {
    dir.removeSync({ recursive: true });
  }
});

Deno.test("setVersion updates a Cargo.lock with windows newlines", () => {
  const dir = createTempDir();
  try {
    dir.join("Cargo.toml").writeTextSync(CARGO_TOML.replaceAll("\n", "\r\n"));
    dir.join("Cargo.lock").writeTextSync(CARGO_LOCK.replaceAll("\n", "\r\n"));

    new CargoToml(dir.join("Cargo.toml")).setVersion("1.0.0");

    assertEquals(
      dir.join("Cargo.lock").readTextSync(),
      CARGO_LOCK.replace(
        `name = "dprint-plugin-example"\nversion = "0.15.2"`,
        `name = "dprint-plugin-example"\nversion = "1.0.0"`,
      )
        .replaceAll("\n", "\r\n"),
    );
  } finally {
    dir.removeSync({ recursive: true });
  }
});

Deno.test("setVersion updates the Cargo.lock of the workspace a crate is in", () => {
  const dir = createTempDir();
  try {
    const crateDir = dir.join("crates", "example");
    crateDir.mkdirSync({ recursive: true });
    crateDir.join("Cargo.toml").writeTextSync(CARGO_TOML);
    dir.join("Cargo.lock").writeTextSync(CARGO_LOCK);

    new CargoToml(crateDir.join("Cargo.toml")).setVersion("0.16.0");

    assertEquals(
      dir.join("Cargo.lock").readTextSync(),
      CARGO_LOCK.replace(
        `name = "dprint-plugin-example"\nversion = "0.15.2"`,
        `name = "dprint-plugin-example"\nversion = "0.16.0"`,
      ),
    );
  } finally {
    dir.removeSync({ recursive: true });
  }
});

Deno.test("setVersion works without a Cargo.lock", () => {
  const dir = createTempDir();
  try {
    dir.join("Cargo.toml").writeTextSync(CARGO_TOML);

    const cargoToml = new CargoToml(dir.join("Cargo.toml"));
    cargoToml.setVersion("0.15.3");

    assertEquals(cargoToml.version(), "0.15.3");
  } finally {
    dir.removeSync({ recursive: true });
  }
});

function createTempDir() {
  return $.path(Deno.makeTempDirSync());
}
