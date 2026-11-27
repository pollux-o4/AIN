import { existsSync, lstatSync, readdirSync, realpathSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { AI_MODELS } from "../../contracts/ai-models.mjs";
import { DEFAULT_OUTBOX, dataDir, LIVE_RUNTIME_DIR, OUTBOX_ENV } from "../../contracts/runtime.mjs";

export const root = realpathSync(fileURLToPath(new URL("../../../", import.meta.url)));

export function canonical(path, cwd = root) {
  let prefix = resolve(cwd, path);
  const tail = [];
  while (!existsSync(prefix)) {
    tail.unshift(basename(prefix));
    prefix = dirname(prefix);
  }
  return join(realpathSync(prefix), ...tail);
}

export function config(env = process.env) {
  const listen = env.AIN_LISTEN || "127.0.0.1:3230";
  const match = /^127\.0\.0\.1:([1-9]\d{0,4})$/.exec(listen);
  if (!match || Number(match[1]) > 65535)
    throw Error("AIN_LISTEN은 127.0.0.1:포트 형식이어야 합니다.");
  const data = canonical(dataDir(env));
  const control = resolve(root, env.AIN_GO_CONTROL_DIR || ".local/editorial-go");
  const binary = canonical(env.AIN_GO_BINARY || ".local/ain-go");
  const assets = canonical(env.AIN_ASSETS || ".local/editorial-web");
  // The shared paseo.sh and endpoint.mjs use home/; older installs used .local/home/.
  const paseo = canonical(env.PASEO_HOME || defaultPaseoHome());
  const outbox = canonical(env[OUTBOX_ENV] || DEFAULT_OUTBOX);
  const { standard, high } = AI_MODELS;
  const provider = env.AIN_PROVIDER || standard.provider;
  const model = env.AIN_MODEL || standard.model;
  const standardPair = provider === standard.provider && model === standard.model;
  const thinking = env.AIN_THINKING ?? (standardPair ? standard.thinking : "");
  const reviewThinking = env.AIN_REVIEW_THINKING ?? (standardPair ? high.thinking : "");
  return {
    binary,
    assets,
    data,
    paseo,
    control,
    listen,
    port: Number(match[1]),
    origin: `http://${listen}`,
    log: join(control, "editorial.log"),
    pidFile: join(control, "process.json"),
    binaryOverride: Boolean(env.AIN_GO_BINARY),
    assetsOverride: Boolean(env.AIN_ASSETS),
    args: [
      "-listen",
      listen,
      "-data",
      data,
      "-assets",
      assets,
      "-paseo-home",
      paseo,
      "-provider",
      provider,
      "-model",
      model,
      "-outbox",
      outbox,
      ...(thinking ? ["-thinking", thinking] : []),
      ...(reviewThinking ? ["-review-thinking", reviewThinking] : []),
    ],
  };
}

function defaultPaseoHome() {
  return existsSync(resolve(root, "../paseo/home/config.json")) ||
    !existsSync(resolve(root, "../paseo/.local/home/config.json"))
    ? "../paseo/home"
    : "../paseo/.local/home";
}

function latest(path, accept) {
  if (!existsSync(path)) return 0;
  const info = lstatSync(path);
  if (info.isDirectory()) {
    return readdirSync(path).reduce(
      (value, name) => Math.max(value, latest(join(path, name), accept)),
      0,
    );
  }
  return info.isFile() && accept(path) ? info.mtimeMs : 0;
}

export function sourceStamp(cfg) {
  const uiFiles = [
    "automation/editorial/ui",
    "automation/contracts",
    "vite.config.ts",
    "tsconfig.json",
    "package.json",
    "pnpm-lock.yaml",
  ];
  return {
    binary: cfg.binaryOverride
      ? latest(cfg.binary, () => true)
      : latest(
          join(root, "backend"),
          (path) => /\.go$|\/go\.(mod|sum)$/.test(path) && !path.endsWith("_test.go"),
        ),
    assets: cfg.assetsOverride
      ? latest(join(cfg.assets, "index.html"), () => true)
      : Math.max(0, ...uiFiles.map((path) => latest(join(root, path), () => true))),
  };
}

export function legacyDefault(cwd) {
  return canonical(LIVE_RUNTIME_DIR, cwd);
}
