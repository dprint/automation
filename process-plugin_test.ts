import { assertEquals } from "@std/assert";
import { getChecksum } from "./hash.ts";
import {
  createDprintOrgNpmPackages,
  getStandardZipFileName,
  type Platform,
  PluginFileBuilder,
} from "./process-plugin.ts";

Deno.test("getStandardZipFileName maps every Platform variant", () => {
  const cases: Array<[Platform, string]> = [
    ["darwin-x86_64", "foo-x86_64-apple-darwin.zip"],
    ["darwin-aarch64", "foo-aarch64-apple-darwin.zip"],
    ["linux-x86_64", "foo-x86_64-unknown-linux-gnu.zip"],
    ["linux-x86_64-musl", "foo-x86_64-unknown-linux-musl.zip"],
    ["linux-aarch64", "foo-aarch64-unknown-linux-gnu.zip"],
    ["linux-aarch64-musl", "foo-aarch64-unknown-linux-musl.zip"],
    ["linux-riscv64", "foo-riscv64gc-unknown-linux-gnu.zip"],
    ["linux-riscv64-musl", "foo-riscv64gc-unknown-linux-musl.zip"],
    ["linux-loongarch64", "foo-loongarch64-unknown-linux-gnu.zip"],
    ["linux-loongarch64-musl", "foo-loongarch64-unknown-linux-musl.zip"],
    ["windows-x86_64", "foo-x86_64-pc-windows-msvc.zip"],
    ["windows-aarch64", "foo-aarch64-pc-windows-msvc.zip"],
  ];
  for (const [platform, expected] of cases) {
    assertEquals(getStandardZipFileName("foo", platform), expected);
  }
});

Deno.test("PluginFileBuilder outputs canonical schema and matching checksum", async () => {
  await withTempDir(async (root) => {
    const zipPath = `${root}/z.zip`;
    const bytes = new Uint8Array([10, 20, 30, 40]);
    await Deno.writeFile(zipPath, bytes);
    const expectedZipChecksum = await getChecksum(bytes);

    const builder = new PluginFileBuilder({ name: "foo", version: "1.0.0" });
    assertEquals(builder.pluginName, "foo");
    assertEquals(builder.version, "1.0.0");

    await builder.addPlatform({
      platform: "linux-x86_64",
      zipFilePath: zipPath,
      zipUrl: "https://example.com/foo-linux.zip",
    });

    assertEquals(JSON.parse(builder.outputText()), {
      schemaVersion: 2,
      kind: "process",
      name: "foo",
      version: "1.0.0",
      "linux-x86_64": {
        reference: "https://example.com/foo-linux.zip",
        checksum: expectedZipChecksum,
      },
    });

    assertEquals(builder.outputText().endsWith("\n"), true);

    assertEquals(
      await builder.outputTextChecksum(),
      await getChecksum(new TextEncoder().encode(builder.outputText())),
    );
  });
});

Deno.test("PluginFileBuilder.writeToPath writes outputText verbatim", async () => {
  await withTempDir(async (root) => {
    const builder = new PluginFileBuilder({ name: "foo", version: "9.9.9" });
    const path = `${root}/plugin.json`;
    await builder.writeToPath(path);
    assertEquals(await Deno.readTextFile(path), builder.outputText());
  });
});

Deno.test("createDprintOrgNpmPackages: full layout for plugin convention", async () => {
  await withTempDir(async (root) => {
    const linuxZip = `${root}/linux.zip`;
    const darwinZip = `${root}/darwin.zip`;
    const winZip = `${root}/win.zip`;
    const linuxBytes = new TextEncoder().encode("linux zip content");
    const darwinBytes = new TextEncoder().encode("darwin zip content");
    const winBytes = new TextEncoder().encode("win zip content");
    await Deno.writeFile(linuxZip, linuxBytes);
    await Deno.writeFile(darwinZip, darwinBytes);
    await Deno.writeFile(winZip, winBytes);

    const outDir = `${root}/out`;
    const result = await createDprintOrgNpmPackages({
      pluginName: "dprint-plugin-exec",
      version: "1.2.3",
      mainPackageName: "@dprint/exec",
      outDir,
      platforms: [
        { platform: "linux-x86_64", zipFilePath: linuxZip },
        { platform: "darwin-aarch64", zipFilePath: darwinZip },
        { platform: "windows-x86_64", zipFilePath: winZip },
      ],
    });

    assertEquals(result.mainPackageDir, `${outDir}/exec`);
    assertEquals(result.subPackageDirs, [
      `${outDir}/exec-linux-x64-glibc`,
      `${outDir}/exec-darwin-arm64`,
      `${outDir}/exec-win32-x64`,
    ]);

    assertEquals(await listRelativeFiles(outDir), [
      "exec-darwin-arm64/package.json",
      "exec-darwin-arm64/plugin.zip",
      "exec-linux-x64-glibc/package.json",
      "exec-linux-x64-glibc/plugin.zip",
      "exec-win32-x64/package.json",
      "exec-win32-x64/plugin.zip",
      "exec/package.json",
      "exec/plugin.json",
    ]);

    assertEquals(
      JSON.parse(await Deno.readTextFile(`${outDir}/exec/package.json`)),
      {
        name: "@dprint/exec",
        version: "1.2.3",
        optionalDependencies: {
          "@dprint/exec-linux-x64-glibc": "1.2.3",
          "@dprint/exec-darwin-arm64": "1.2.3",
          "@dprint/exec-win32-x64": "1.2.3",
        },
      },
    );

    assertEquals(
      JSON.parse(await Deno.readTextFile(`${outDir}/exec/plugin.json`)),
      {
        schemaVersion: 2,
        kind: "process",
        name: "dprint-plugin-exec",
        version: "1.2.3",
        "linux-x86_64": {
          reference: "npm:@dprint/exec-linux-x64-glibc@1.2.3/plugin.zip",
          checksum: await getChecksum(linuxBytes),
        },
        "darwin-aarch64": {
          reference: "npm:@dprint/exec-darwin-arm64@1.2.3/plugin.zip",
          checksum: await getChecksum(darwinBytes),
        },
        "windows-x86_64": {
          reference: "npm:@dprint/exec-win32-x64@1.2.3/plugin.zip",
          checksum: await getChecksum(winBytes),
        },
      },
    );

    assertEquals(
      JSON.parse(
        await Deno.readTextFile(`${outDir}/exec-linux-x64-glibc/package.json`),
      ),
      {
        name: "@dprint/exec-linux-x64-glibc",
        version: "1.2.3",
        os: ["linux"],
        cpu: ["x64"],
        libc: ["glibc"],
      },
    );

    assertEquals(
      JSON.parse(
        await Deno.readTextFile(`${outDir}/exec-darwin-arm64/package.json`),
      ),
      {
        name: "@dprint/exec-darwin-arm64",
        version: "1.2.3",
        os: ["darwin"],
        cpu: ["arm64"],
      },
    );

    assertEquals(
      JSON.parse(
        await Deno.readTextFile(`${outDir}/exec-win32-x64/package.json`),
      ),
      {
        name: "@dprint/exec-win32-x64",
        version: "1.2.3",
        os: ["win32"],
        cpu: ["x64"],
      },
    );

    assertEquals(
      await Deno.readFile(`${outDir}/exec-linux-x64-glibc/plugin.zip`),
      linuxBytes,
    );
  });
});

Deno.test("createDprintOrgNpmPackages: subPackagePrefix produces CLI-style names", async () => {
  await withTempDir(async (root) => {
    const zip = `${root}/z.zip`;
    await Deno.writeFile(zip, new Uint8Array([1, 2, 3]));

    const outDir = `${root}/out`;
    const result = await createDprintOrgNpmPackages({
      pluginName: "dprint",
      version: "0.54.0",
      mainPackageName: "dprint",
      subPackagePrefix: "@dprint/",
      outDir,
      platforms: [
        { platform: "linux-x86_64", zipFilePath: zip },
        { platform: "windows-x86_64", zipFilePath: zip },
      ],
    });

    assertEquals(result.mainPackageDir, `${outDir}/dprint`);
    assertEquals(result.subPackageDirs, [
      `${outDir}/linux-x64-glibc`,
      `${outDir}/win32-x64`,
    ]);

    const mainPkg = JSON.parse(
      await Deno.readTextFile(`${outDir}/dprint/package.json`),
    );
    assertEquals(mainPkg.name, "dprint");
    assertEquals(mainPkg.optionalDependencies, {
      "@dprint/linux-x64-glibc": "0.54.0",
      "@dprint/win32-x64": "0.54.0",
    });

    assertEquals(
      JSON.parse(
        await Deno.readTextFile(`${outDir}/linux-x64-glibc/package.json`),
      ).name,
      "@dprint/linux-x64-glibc",
    );

    const pluginJson = JSON.parse(
      await Deno.readTextFile(`${outDir}/dprint/plugin.json`),
    );
    assertEquals(
      pluginJson["linux-x86_64"].reference,
      "npm:@dprint/linux-x64-glibc@0.54.0/plugin.zip",
    );
    assertEquals(
      pluginJson["windows-x86_64"].reference,
      "npm:@dprint/win32-x64@0.54.0/plugin.zip",
    );
  });
});

Deno.test("createDprintOrgNpmPackages: packageJsonExtra merges but managed fields win", async () => {
  await withTempDir(async (root) => {
    const zip = `${root}/z.zip`;
    await Deno.writeFile(zip, new Uint8Array([0]));

    const outDir = `${root}/out`;
    await createDprintOrgNpmPackages({
      pluginName: "p",
      version: "1.0.0",
      mainPackageName: "@x/p",
      outDir,
      platforms: [
        // darwin has no libc — managed override must drop a stray
        // libc value supplied via packageJsonExtra.
        { platform: "darwin-aarch64", zipFilePath: zip },
      ],
      packageJsonExtra: {
        description: "desc",
        license: "MIT",
        repository: { type: "git", url: "git+https://example.com/x.git" },
        // attempted overrides — must all be ignored
        name: "WRONG",
        version: "9.9.9",
        os: ["should-be-overridden"],
        cpu: ["should-be-overridden"],
        libc: ["should-be-dropped"],
        optionalDependencies: { foo: "1" },
      },
    });

    const mainPkg = JSON.parse(
      await Deno.readTextFile(`${outDir}/p/package.json`),
    );
    assertEquals(mainPkg.description, "desc");
    assertEquals(mainPkg.license, "MIT");
    assertEquals(mainPkg.repository, {
      type: "git",
      url: "git+https://example.com/x.git",
    });
    assertEquals(mainPkg.name, "@x/p");
    assertEquals(mainPkg.version, "1.0.0");
    assertEquals(mainPkg.optionalDependencies, {
      "@x/p-darwin-arm64": "1.0.0",
    });

    const subPkg = JSON.parse(
      await Deno.readTextFile(`${outDir}/p-darwin-arm64/package.json`),
    );
    assertEquals(subPkg.description, "desc");
    assertEquals(subPkg.license, "MIT");
    assertEquals(subPkg.name, "@x/p-darwin-arm64");
    assertEquals(subPkg.version, "1.0.0");
    assertEquals(subPkg.os, ["darwin"]);
    assertEquals(subPkg.cpu, ["arm64"]);
    // libc was supplied via packageJsonExtra but must be dropped on darwin
    assertEquals(Object.hasOwn(subPkg, "libc"), false);
  });
});

async function withTempDir(fn: (dir: string) => Promise<void>) {
  const dir = await Deno.makeTempDir();
  try {
    await fn(normalizePath(dir));
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

async function listRelativeFiles(root: string): Promise<string[]> {
  const out: string[] = [];
  await walk(root, (p) => out.push(p.substring(root.length + 1)));
  out.sort();
  return out;
}

async function walk(dir: string, visit: (path: string) => void): Promise<void> {
  for await (const entry of Deno.readDir(dir)) {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory) {
      await walk(path, visit);
    } else {
      visit(path);
    }
  }
}

function normalizePath(path: string): string {
  return path.replaceAll("\\", "/");
}
