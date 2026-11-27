import { createHash } from "node:crypto";
import { lstat, readdir, readFile, writeFile } from "node:fs/promises";
import { join, posix } from "node:path";

export const uiRoot = "share/ain/editorial-web";
const name = "manifest.json";
export const hash = (data) => createHash("sha256").update(data).digest("hex");

export async function inventory(root, relative = "") {
  const results = [];
  const entries = await readdir(join(root, relative), { withFileTypes: true });
  for (const entry of entries) {
    const path = posix.join(relative, entry.name);
    if (path === name) continue;
    if (entry.isDirectory()) {
      results.push(...(await inventory(root, path)));
    } else if (entry.isFile()) {
      const data = await readFile(join(root, path));
      results.push({ path, bytes: data.length, sha256: hash(data) });
    } else {
      throw new Error("Runtime package contains a symlink or non-regular entry");
    }
  }
  return results.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

export async function writeManifest(root, { staging, revision, version, target }) {
  const files = await inventory(root);
  validateLayout(files, staging);
  await writeFile(
    join(root, name),
    `${JSON.stringify({ schema: 1, staging, revision, version, target, files }, null, 2)}\n`,
    { flag: "wx" },
  );
}

export async function verifyManifest(root) {
  if (!(await lstat(root)).isDirectory()) throw new Error("Package must be a directory");
  const manifestPath = join(root, name);
  if (!(await lstat(manifestPath)).isFile())
    throw new Error("Package manifest must be a regular file");
  const recorded = JSON.parse(await readFile(manifestPath, "utf8"));
  const actual = await inventory(root);
  if (
    recorded.schema !== 1 ||
    typeof recorded.staging !== "boolean" ||
    JSON.stringify(actual) !== JSON.stringify(recorded.files)
  )
    throw new Error("Package file inventory or digest differs");
  validateLayout(actual, recorded.staging);
  return recorded;
}

function validateLayout(files, staging) {
  const binary = files.filter(({ path }) => path === "bin/ain").length;
  if (binary !== 1 || !files.some(({ path }) => path === `${uiRoot}/index.html`))
    throw new Error("Package is missing the executable or editor index");
  if (!files.some(({ path }) => path === "share/licenses/index.json"))
    throw new Error("Runtime license inventory is missing");
  if (!files.some(({ path }) => path === (staging ? "STAGING.txt" : "LICENSE")))
    throw new Error("Package distribution notice is missing");
  for (const { path } of files) {
    if (["bin/ain", `${uiRoot}/index.html`, "LICENSE", "STAGING.txt", "README.md"].includes(path))
      continue;
    if (path.startsWith("share/licenses/")) continue;
    if (
      !path.startsWith(`${uiRoot}/assets/`) ||
      !/^[\w-]+\.(?:js|css|woff2)$/.test(path.slice(`${uiRoot}/assets/`.length))
    )
      throw new Error("Unexpected file in runtime package");
  }
}
