export async function extractCargoVersion(filePath: string) {
  const packageText = await Deno.readTextFile(filePath);
  // version = "x.x.x"
  const version = packageText.match(/version\s*=\s*\"(\d+\.\d+\.\d+)\"/)?.[1];
  if (version == null) {
    throw new Error(`Could not find version in Cargo.toml at ${filePath}`);
  }
  return version;
}
