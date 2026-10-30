import { build } from "esbuild";
import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { x as extract } from "tar";
import { upstreamPatches } from "../patches/upstream.mjs";
import { fetchUpstream, root } from "./fetch-upstream.mjs";
import { patchBundle } from "./patch.mjs";

export const output = path.join(root, ".build", "package");

// Digest every untouched upstream file, including all packed browser assets.
// Kept in the assembled package so tests and recipients can verify reuse.
export async function fileDigests(directory, prefix = "") {
  const digests = {};
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relative = prefix + entry.name;
    if (entry.isDirectory()) {
      Object.assign(digests, await fileDigests(path.join(directory, entry.name), relative + "/"));
    } else if (entry.isFile()) {
      digests[relative] = createHash("sha256").update(await readFile(path.join(directory, entry.name))).digest("hex");
    } else {
      throw new Error(`Unexpected non-regular upstream file: ${relative}`);
    }
  }
  return digests;
}

export async function assemble() {
  const { archive, pin } = await fetchUpstream();
  const project = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
  if (!project.distribution.name || !project.distribution.version.startsWith(pin.version + "-")) {
    throw new Error("distribution must specify a package name and a prerelease version based on the pinned upstream version.");
  }
  await mkdir(path.join(root, ".build"), { recursive: true });
  const stage = await mkdtemp(path.join(root, ".build", "stage-"));
  try {
    await extract({
      file: archive, cwd: stage, strict: true,
      filter(name, entry) {
        if (!name.startsWith("package/") || name.split("/").includes("..") ||
            !["File", "Directory"].includes(entry.type)) {
          throw new Error(`Unsafe or unsupported upstream archive entry: ${name}`);
        }
        return true;
      },
    });
    const directory = path.join(stage, "package");
    const original = JSON.parse(await readFile(path.join(directory, "package.json"), "utf8"));
    if (original.name !== pin.name || original.version !== pin.version) {
      throw new Error("The upstream package identity does not match upstream.json.");
    }
    const originals = await fileDigests(directory);
    const patches = upstreamPatches(project.distribution.name);
    // Validate every edit in memory before writing any modified bundle.
    const patched = await Promise.all(patches.map(async patch => ({
      file: patch.file,
      content: patchBundle(await readFile(path.join(directory, patch.file), "utf8"), patch),
    })));
    for (const { file, content } of patched) await writeFile(path.join(directory, file), content);

    await build({
      absWorkingDir: root,
      entryPoints: { "tui-runtime": "src/tui-runtime.ts", tui: "src/tui-entry.ts" },
      outdir: path.join(directory, "dist"),
      bundle: true, format: "esm", platform: "node", target: "node22",
      banner: { js: "/* Terminal-review modules from the standalone patch; see PATCH-NOTICE.md. */" },
    });
    // No upstream build or prepublish hooks survive into the replacement.
    const manifest = Object.fromEntries(Object.entries(original).filter(([key]) =>
      !key.startsWith("//") && !["scripts", "devDependencies", "repository", "homepage", "bugs"].includes(key)));
    Object.assign(manifest, {
      name: project.distribution.name,
      version: project.distribution.version,
      description: "Plannotator for OpenCode with terminal plan review; reuses the official prebuilt browser apps",
      exports: { ...original.exports, "./tui": "./dist/tui.js" },
      publishConfig: { access: "public" },
      scripts: { postinstall: original.scripts.postinstall },
      files: [...original.files, "LICENSE-MIT", "LICENSE-APACHE", "PATCH-NOTICE.md", "upstream-release.json"],
    });
    await writeFile(path.join(directory, "package.json"), JSON.stringify(manifest, null, 2) + "\n");
    for (const file of ["README.md", "LICENSE-MIT", "LICENSE-APACHE", "PATCH-NOTICE.md"]) {
      await cp(path.join(root, file), path.join(directory, file));
    }
    const changed = new Set(["package.json", "README.md", ...patches.map(patch => patch.file)]);
    const untouched = Object.fromEntries(Object.entries(originals).filter(([file]) => !changed.has(file)));
    await writeFile(path.join(directory, "upstream-release.json"), JSON.stringify({
      ...pin, unchangedFiles: untouched,
    }, null, 2) + "\n");

    // Only this generated output is replaced. A failed build leaves the last
    // working package intact; no source files or user configuration are touched.
    await rm(output, { recursive: true, force: true });
    await rename(directory, output);
    console.log(`Assembled ${manifest.name}@${manifest.version}: ${output}`);
    console.log(`${Object.keys(untouched).length} upstream files reused byte-for-byte; only two small TUI bundles compiled.`);
    return { directory: output, manifest };
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  await assemble();
}
