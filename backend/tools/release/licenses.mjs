import { copyFile, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, relative, sep } from "node:path";

const notice = /(?:^|[-_.])(?:license|licence|copying|notice|patents|ofl)(?:[-_.]|$)/i;

async function notices(dir) {
  return (await readdir(dir, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && notice.test(entry.name))
    .map(({ name }) => name)
    .sort();
}

async function copyNotices({ name, version, kind, source, sourceFiles, licenses, entries }) {
  const names = sourceFiles ?? (await notices(source));
  if (!names.length) throw new Error(`Bundled dependency lacks license text: ${name}`);
  const prefix = join(kind, name);
  const dest = join(licenses, prefix);
  await mkdir(dest, { recursive: true });
  for (const file of names)
    await copyFile(join(source, file), join(dest, file.replaceAll("/", "-")));
  entries.push({
    name,
    version,
    kind,
    notices: names.map((file) => join(prefix, file.replaceAll("/", "-"))),
  });
}

export async function collectLicenses({ repo, destination, viteReport, binary, execGo, goRoot }) {
  const licenses = join(destination, "share/licenses");
  await mkdir(licenses, { recursive: true });
  const entries = [];
  const settings = { entries, licenses };

  const binaryInfo = (await execGo(["version", "-m", binary])).split("\n");
  const goVersion = binaryInfo[0].trim().split(/\s+/).at(-1);
  const dependencies = binaryInfo
    .map((line) => line.trim().split(/\s+/))
    .filter(([kind]) => kind === "dep");
  if (!dependencies.length || binaryInfo.some((line) => line.trim().startsWith("=>")))
    throw new Error("Missing or replaced Go binary dependencies require notice review");
  await copyNotices({
    ...settings,
    name: "go",
    version: goVersion,
    kind: "toolchain",
    source: goRoot,
  });
  for (const [, name, version] of dependencies) {
    const info = JSON.parse(await execGo(["list", "-m", "-json", name]));
    if (info.Version !== version || !info.Dir)
      throw new Error(`License source does not match Go binary module: ${name}`);
    await copyNotices({ ...settings, name, version, kind: "go-modules", source: info.Dir });
  }

  const vendor = join(goRoot, "src", "vendor");
  const usedVendorRoots = new Map();
  const standard = await execGo([
    "list",
    "-deps",
    "-f",
    "{{if .Standard}}{{.ImportPath}}\t{{.Dir}}{{end}}",
    "./cmd/ain",
  ]);
  for (const line of standard.split("\n")) {
    if (!line.startsWith("vendor/")) continue;
    let dir = line.split("\t")[1];
    for (;;) {
      const subpath = relative(vendor, dir);
      if (!subpath || subpath.startsWith(`..${sep}`))
        throw new Error("Vendored Go package lacks notices");
      const sourceFiles = await notices(dir);
      if (sourceFiles.length) {
        usedVendorRoots.set(subpath, { dir, sourceFiles });
        break;
      }
      dir = dirname(dir);
    }
  }
  for (const [name, { dir, sourceFiles }] of usedVendorRoots) {
    await copyNotices({
      ...settings,
      name,
      version: goVersion,
      kind: "go-vendor",
      source: dir,
      sourceFiles,
    });
  }

  const js = JSON.parse(await readFile(viteReport, "utf8"));
  if (!Array.isArray(js) || !js.length || js.some(({ text }) => !text))
    throw new Error("Vite did not report all bundled JavaScript license texts");
  if (js.some(({ name }) => /^(?:n8n(?:$|-)|@n8n\/|@getpaseo\/)/.test(name)))
    throw new Error("The runtime UI cannot bundle n8n or the standalone Paseo SDK");
  await writeFile(join(licenses, "bundled-js.json"), `${JSON.stringify(js, null, 2)}\n`);
  for (const { name, version, identifier } of js)
    entries.push({ name, version, identifier, kind: "bundled-js", notices: ["bundled-js.json"] });

  // CSS/font assets and Vite's virtual module-preload helper are outside Vite's JS report.
  for (const [name, sourceFiles] of [
    ["tailwindcss", null],
    ["galmuri", ["ofl.md", "dist/LICENSE.txt"]],
    ["vite", null],
  ]) {
    const source = join(repo, "node_modules", name);
    const { version } = JSON.parse(await readFile(join(source, "package.json"), "utf8"));
    await copyNotices({ ...settings, name, version, kind: "editor-assets", source, sourceFiles });
  }
  await copyNotices({
    ...settings,
    name: "paseo",
    version: "0.17.5",
    kind: "protocol-references",
    source: join(repo, "backend/internal/paseowire/upstream"),
    sourceFiles: ["LICENSE", "NOTICE"],
  });
  entries.sort((a, b) => `${a.kind}/${a.name}`.localeCompare(`${b.kind}/${b.name}`, "en"));
  await writeFile(join(licenses, "index.json"), `${JSON.stringify(entries, null, 2)}\n`);
}
