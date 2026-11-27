import { execFile, spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { paseoHome } from "../../contracts/paseo-home.mjs";
import { requireLiveConsent } from "./consent.mjs";

const repository = fileURLToPath(new URL("../../../", import.meta.url));
const execute = promisify(execFile);

export async function buildProbe(binary) {
  await execute("go", [
    "-C",
    join(repository, "backend"),
    "build",
    "-o",
    binary,
    "./tools/liveprobe",
  ]);
}

export async function runProbe(binary, config) {
  requireLiveConsent("격리 Go 검증");
  const home = paseoHome();
  const child = spawn(binary, [], {
    env: { ...process.env, AIN_LIVE: "1" },
    stdio: ["pipe", "ignore", "ignore"],
  });
  child.stdin.on("error", () => {});
  const relay = (signal) => () => {
    process.exitCode = signal === "SIGINT" ? 130 : 143;
    child.kill("SIGTERM");
  };
  const interrupt = relay("SIGINT");
  const terminate = relay("SIGTERM");
  process.on("SIGINT", interrupt);
  process.on("SIGTERM", terminate);
  try {
    const exited = new Promise((done, reject) => {
      child.once("close", (code) => done(code));
      child.once("error", reject);
    });
    child.stdin.end(JSON.stringify({ ...config, home }));
    const status = await exited;
    const result = await readFile(join(config.root, "outcome.json"), "utf8")
      .then(JSON.parse)
      .catch(() => null);
    return { status, result };
  } finally {
    process.off("SIGINT", interrupt);
    process.off("SIGTERM", terminate);
  }
}
