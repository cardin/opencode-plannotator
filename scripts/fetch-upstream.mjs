import { createHash, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const root = fileURLToPath(new URL("../", import.meta.url));

export function verifyIntegrity(bytes, integrity) {
  const match = /^sha512-([A-Za-z0-9+/]+={0,2})$/.exec(integrity);
  if (!match) throw new Error("The upstream pin must contain a SHA-512 integrity hash.");
  const expected = Buffer.from(match[1], "base64");
  const actual = createHash("sha512").update(bytes).digest();
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    throw new Error("Upstream archive integrity mismatch; refusing to assemble this package.");
  }
}

export async function fetchUpstream() {
  const pin = JSON.parse(await readFile(path.join(root, "upstream.json"), "utf8"));
  const cache = path.join(root, ".cache");
  await mkdir(cache, { recursive: true });
  const archive = path.join(cache, `opencode-${pin.version}.tgz`);
  let bytes;
  try {
    bytes = await readFile(archive);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    const url = new URL(pin.tarball);
    if (url.protocol !== "https:" || url.hostname !== "registry.npmjs.org") {
      throw new Error("The upstream archive must come from the HTTPS npm registry.");
    }
    console.log(`Downloading ${pin.name}@${pin.version} (prebuilt; no install scripts).`);
    const response = await fetch(url, { signal: AbortSignal.timeout(120_000) });
    if (!response.ok) throw new Error(`Upstream download failed: HTTP ${response.status}`);
    bytes = Buffer.from(await response.arrayBuffer());
    verifyIntegrity(bytes, pin.integrity);
    const partial = `${archive}.${process.pid}.partial`;
    try {
      await writeFile(partial, bytes, { flag: "wx" });
      await rename(partial, archive);
    } finally {
      await rm(partial, { force: true });
    }
  }
  // Check cached archives too. A corrupt cache must not silently become a release.
  verifyIntegrity(bytes, pin.integrity);
  return { archive, pin };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const { archive } = await fetchUpstream();
  console.log(`Verified ${archive}`);
}
