export async function extractCargoVersionOrThrow(filePath: string) {
  const packageText = await Deno.readTextFile(filePath);
  const version = extractCargoVersionFromText(packageText);
  if (version == null) {
    throw new Error(`Could not find version in Cargo.toml at ${filePath}`);
  }
  return version;
}

export function extractCargoVersionFromTextOrThrow(packageText: string) {
  const version = extractCargoVersionFromText(packageText);
  if (version == null) {
    throw new Error(`Could not find version in Cargo.toml`);
  }
  return version;
}

export function extractCargoVersionFromText(packageText: string) {
  // version = "x.x.x"
  return packageText.match(/^version\s*=\s*\"(\d+\.\d+\.\d+)$\"/m)?.[1];
}

export function setCargoVersionInText(packageText: string, version: string) {
  const newText = packageText.replace(/^version\s*=\s*\"(\d+\.\d+\.\d+)$\"/m, `version = "${version}"`);
  if (newText === packageText) {
    const currentVersion = extractCargoVersionFromText(packageText);
    if (currentVersion !== version) {
      console.error("File text");
      console.error("=========");
      console.error(newText);
      console.error("=========");
      throw new Error(`No change in Cargo.toml file.`);
    }
  }
  return newText;
}
