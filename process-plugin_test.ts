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
    ["linux-powerpc64", "foo-powerpc64le-unknown-linux-gnu.zip"],
    ["linux-powerpc64-musl", "foo-powerpc64le-unknown-linux-musl.zip"],
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
    const linuxBinary = `${root}/dprint-plugin-exec-linux`;
    const darwinBinary = `${root}/dprint-plugin-exec-darwin`;
    const winBinary = `${root}/dprint-plugin-exec.exe`;
    const linuxBytes = new TextEncoder().encode("linux binary content");
    const darwinBytes = new TextEncoder().encode("darwin binary content");
    const winBytes = new TextEncoder().encode("win binary content");
    await Deno.writeFile(linuxBinary, linuxBytes);
    await Deno.writeFile(darwinBinary, darwinBytes);
    await Deno.writeFile(winBinary, winBytes);

    const outDir = `${root}/out`;
    const platforms: Array<{ platform: Platform; binaryPath: string }> = [
      { platform: "linux-x86_64", binaryPath: linuxBinary },
      { platform: "darwin-aarch64", binaryPath: darwinBinary },
      { platform: "windows-x86_64", binaryPath: winBinary },
    ];
    const result = await createDprintOrgNpmPackages({
      pluginName: "dprint-plugin-exec",
      version: "1.2.3",
      mainPackageName: "@dprint/exec",
      outDir,
      platforms,
    });

    assertEquals(result.mainPackageDir, `${outDir}/exec`);
    assertEquals(result.subPackageDirs, [
      `${outDir}/exec-linux-x64-glibc`,
      `${outDir}/exec-darwin-arm64`,
      `${outDir}/exec-win32-x64`,
    ]);

    // tarballs exist and are non-empty
    for (const t of [...result.subPackageTarballs, result.mainPackageTarball]) {
      const stat = await Deno.stat(t);
      assertEquals(stat.size > 0, true, `${t} should be non-empty`);
    }

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

    // plugin.json shape: per-platform reference correct, checksum is sha256 of the matching tarball.
    const pluginJson = JSON.parse(await Deno.readTextFile(`${outDir}/exec/plugin.json`));
    assertEquals(pluginJson.schemaVersion, 2);
    assertEquals(pluginJson.kind, "process");
    assertEquals(pluginJson.name, "dprint-plugin-exec");
    assertEquals(pluginJson.version, "1.2.3");

    const expectedRefs: Record<string, string> = {
      "linux-x86_64": "npm:@dprint/exec-linux-x64-glibc@1.2.3/dprint-plugin-exec-linux",
      "darwin-aarch64": "npm:@dprint/exec-darwin-arm64@1.2.3/dprint-plugin-exec-darwin",
      "windows-x86_64": "npm:@dprint/exec-win32-x64@1.2.3/dprint-plugin-exec.exe",
    };
    for (let i = 0; i < platforms.length; i++) {
      const key = platforms[i].platform;
      const entry = pluginJson[key];
      assertEquals(entry.reference, expectedRefs[key]);
      assertEquals(
        entry.checksum,
        await getChecksum(await Deno.readFile(result.subPackageTarballs[i])),
        `checksum for ${key} should equal sha256 of its tarball`,
      );
    }

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

    // binary is copied verbatim into the sub-package
    assertEquals(
      await Deno.readFile(`${outDir}/exec-linux-x64-glibc/dprint-plugin-exec-linux`),
      linuxBytes,
    );
    assertEquals(
      await Deno.readFile(`${outDir}/exec-win32-x64/dprint-plugin-exec.exe`),
      winBytes,
    );
  });
});

Deno.test("createDprintOrgNpmPackages: name and version are the first keys in package.json", async () => {
  await withTempDir(async (root) => {
    const binary = `${root}/dprint-plugin-exec`;
    await Deno.writeFile(binary, new Uint8Array([0]));

    const outDir = `${root}/out`;
    await createDprintOrgNpmPackages({
      pluginName: "dprint-plugin-exec",
      version: "1.0.0",
      mainPackageName: "@dprint/exec",
      outDir,
      platforms: [{ platform: "linux-x86_64", binaryPath: binary }],
      packageJsonExtra: {
        description: "desc",
        license: "MIT",
      },
    });

    const mainKeys = Object.keys(
      JSON.parse(await Deno.readTextFile(`${outDir}/exec/package.json`)),
    );
    assertEquals(mainKeys.slice(0, 2), ["name", "version"]);

    const subKeys = Object.keys(
      JSON.parse(
        await Deno.readTextFile(`${outDir}/exec-linux-x64-glibc/package.json`),
      ),
    );
    assertEquals(subKeys.slice(0, 2), ["name", "version"]);
  });
});

Deno.test("createDprintOrgNpmPackages: packageContents ships the whole dir", async () => {
  await withTempDir(async (root) => {
    // simulate a self-contained .NET app layout: an executable plus side
    // files (including in a sub-dir) that must travel together.
    const appDir = `${root}/app`;
    await Deno.mkdir(`${appDir}/runtimes`, { recursive: true });
    const binaryPath = `${appDir}/dprint-plugin-roslyn`;
    await Deno.writeFile(binaryPath, new TextEncoder().encode("bin"));
    await Deno.writeFile(`${appDir}/Microsoft.CodeAnalysis.dll`, new TextEncoder().encode("dll1"));
    await Deno.writeFile(`${appDir}/Microsoft.CSharp.dll`, new TextEncoder().encode("dll2"));
    await Deno.writeFile(`${appDir}/runtimes/libSystem.Native.so`, new TextEncoder().encode("so"));

    const outDir = `${root}/out`;
    const result = await createDprintOrgNpmPackages({
      pluginName: "dprint-plugin-roslyn",
      version: "1.0.0",
      mainPackageName: "@dprint/roslyn",
      outDir,
      platforms: [{ platform: "linux-x86_64", binaryPath, packageContents: appDir }],
    });

    // every file from appDir is now in the sub-package
    const subDir = `${outDir}/roslyn-linux-x64-glibc`;
    assertEquals(await Deno.readTextFile(`${subDir}/dprint-plugin-roslyn`), "bin");
    assertEquals(await Deno.readTextFile(`${subDir}/Microsoft.CodeAnalysis.dll`), "dll1");
    assertEquals(await Deno.readTextFile(`${subDir}/Microsoft.CSharp.dll`), "dll2");
    assertEquals(await Deno.readTextFile(`${subDir}/runtimes/libSystem.Native.so`), "so");

    // plugin.json's reference still names the executable; checksum is the
    // tarball's sha256, which captures every file we just shipped.
    const pluginJson = JSON.parse(await Deno.readTextFile(`${outDir}/roslyn/plugin.json`));
    assertEquals(
      pluginJson["linux-x86_64"].reference,
      "npm:@dprint/roslyn-linux-x64-glibc@1.0.0/dprint-plugin-roslyn",
    );
    assertEquals(
      pluginJson["linux-x86_64"].checksum,
      await getChecksum(await Deno.readFile(result.subPackageTarballs[0])),
    );
  });
});

Deno.test("createDprintOrgNpmPackages: packageContents rejects binaryPath outside the dir", async () => {
  await withTempDir(async (root) => {
    await Deno.mkdir(`${root}/app`);
    await Deno.writeFile(`${root}/app/inside`, new Uint8Array([1]));
    const outsideBinary = `${root}/outside`;
    await Deno.writeFile(outsideBinary, new Uint8Array([1]));

    let threw = false;
    try {
      await createDprintOrgNpmPackages({
        pluginName: "p",
        version: "1.0.0",
        mainPackageName: "@x/p",
        outDir: `${root}/out`,
        platforms: [{
          platform: "linux-x86_64",
          binaryPath: outsideBinary,
          packageContents: `${root}/app`,
        }],
      });
    } catch (err) {
      threw = true;
      assertEquals(
        (err as Error).message.includes("must be inside packageContents"),
        true,
      );
    }
    assertEquals(threw, true, "expected an error");
  });
});

Deno.test("createDprintOrgNpmPackages: subPackagePrefix produces CLI-style names", async () => {
  await withTempDir(async (root) => {
    const unixBinary = `${root}/dprint`;
    const winBinary = `${root}/dprint.exe`;
    await Deno.writeFile(unixBinary, new Uint8Array([1, 2, 3]));
    await Deno.writeFile(winBinary, new Uint8Array([1, 2, 3]));

    const outDir = `${root}/out`;
    const result = await createDprintOrgNpmPackages({
      pluginName: "dprint",
      version: "0.54.0",
      mainPackageName: "dprint",
      subPackagePrefix: "@dprint/",
      outDir,
      platforms: [
        { platform: "linux-x86_64", binaryPath: unixBinary },
        { platform: "windows-x86_64", binaryPath: winBinary },
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
      "npm:@dprint/linux-x64-glibc@0.54.0/dprint",
    );
    assertEquals(
      pluginJson["windows-x86_64"].reference,
      "npm:@dprint/win32-x64@0.54.0/dprint.exe",
    );
  });
});

Deno.test("createDprintOrgNpmPackages: packageJsonExtra merges but managed fields win", async () => {
  await withTempDir(async (root) => {
    const binary = `${root}/p`;
    await Deno.writeFile(binary, new Uint8Array([0]));

    const outDir = `${root}/out`;
    await createDprintOrgNpmPackages({
      pluginName: "p",
      version: "1.0.0",
      mainPackageName: "@x/p",
      outDir,
      platforms: [
        // darwin has no libc — managed override must drop a stray
        // libc value supplied via packageJsonExtra.
        { platform: "darwin-aarch64", binaryPath: binary },
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
