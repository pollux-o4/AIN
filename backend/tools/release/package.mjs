import { execFile } from "node:child_process";
import { constants } from "node:fs";
import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs, promisify } from "node:util";
import { collectLicenses } from "./licenses.mjs";
import { uiRoot, writeManifest } from "./manifest.mjs";

const exec = promisify(execFile);
const repo = fileURLToPath(new URL("../../../", import.meta.url));
const here = fileURLToPath(new URL("./", import.meta.url));
const { values } = parseArgs({
  options: { output: { type: "string" }, staging: { type: "boolean" } },
});
if (!values.output)
  throw new Error("Usage: node backend/tools/release/package.mjs --output PATH [--staging]");
const destination = resolve(values.output);
const staging = values.staging === true;
const rootLicense = join(repo, "LICENSE");
if (!staging) {
  const license = await readFile(rootLicense, "utf8").catch(() => "");
  if (
    !license.includes("MIT License") ||
    !/^Copyright[^\n]+$/m.test(license) ||
    !license.includes("Permission is hereby granted, free of charge") ||
    /\[fullname\]|\[year\]|<copyright holders?>/i.test(license)
  ) {
    throw new Error(
      "External packaging requires the approved AIN MIT LICENSE with its copyright holder",
    );
  }
}
async function ensureNewPath() {
  try {
    await lstat(destination);
    throw new Error("Output directory already exists");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}
await ensureNewPath();
const stage = await mkdtemp(join(dirname(destination), ".ain-release-"));
try {
  process.chdir(repo);
  const { stdout: targetList } = await exec("go", ["env", "GOHOSTOS", "GOHOSTARCH", "GOROOT"]);
  const [GOOS, GOARCH, goRoot] = targetList.trim().split("\n");
  if (GOOS !== "linux") throw new Error("This package is validated for native Linux builds");
  const goEnv = {
    ...process.env,
    GOOS,
    GOARCH,
    CGO_ENABLED: "0",
    GOFLAGS: "-mod=readonly",
    GOWORK: "off",
  };
  const execGo = async (args) =>
    (
      await exec("go", args, {
        cwd: join(repo, "backend"),
        env: goEnv,
        maxBuffer: 4 * 1024 * 1024,
      })
    ).stdout;
  const binary = join(stage, "bin", "ain");
  const assets = join(stage, uiRoot);
  await mkdir(dirname(binary), { recursive: true });
  await execGo(["build", "-trimpath", "-buildvcs=false", "-o", binary, "./cmd/ain"]);
  const binaryInfo = await execGo(["version", "-m", binary]);
  if (!binaryInfo.includes("CGO_ENABLED=0"))
    throw new Error("Go binary has an unexpected CGO setting");
  await chmod(binary, 0o755);

  for (const key of Object.keys(process.env)) if (key.startsWith("VITE_")) delete process.env[key];
  process.env.NODE_ENV = "production";
  const { build } = await import("vite");
  const reportFile = ".vite/release-licenses.json";
  await build({
    configFile: join(repo, "vite.config.ts"),
    envDir: false,
    publicDir: false,
    logLevel: "warn",
    build: {
      outDir: assets,
      emptyOutDir: true,
      sourcemap: false,
      license: { fileName: reportFile },
    },
  });
  await collectLicenses({
    repo,
    destination: stage,
    viteReport: join(assets, reportFile),
    binary,
    execGo,
    goRoot,
  });
  await rm(join(assets, ".vite"), { recursive: true });
  await copyFile(join(here, "RUNTIME.md"), join(stage, "README.md"), constants.COPYFILE_EXCL);
  if (staging) {
    await writeFile(
      join(stage, "STAGING.txt"),
      "Internal rehearsal package. External distribution awaits AIN copyright and license approval.\n",
    );
  } else {
    await copyFile(rootLicense, join(stage, "LICENSE"), constants.COPYFILE_EXCL);
  }
  const target = `${GOOS}/${GOARCH}`;
  const { stdout: gitRevision } = await exec("git", ["rev-parse", "HEAD"]);
  const { version } = JSON.parse(await readFile(join(repo, "package.json"), "utf8"));
  await writeManifest(stage, { staging, revision: gitRevision.trim(), version, target });
  await ensureNewPath();
  await rename(stage, destination);
  console.log(
    `${staging ? "Internal staging" : "Release candidate"} package: ${destination} (${target})`,
  );
} finally {
  await rm(stage, { recursive: true, force: true });
}
