import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repository = fileURLToPath(new URL("../../", import.meta.url));

export function paseoHome(env = process.env) {
  if (env.PASEO_HOME) return resolve(repository, env.PASEO_HOME);
  const current = resolve(repository, "../paseo/home");
  const previous = resolve(repository, "../paseo/.local/home");
  return !existsSync(join(current, "config.json")) && existsSync(join(previous, "config.json"))
    ? previous
    : current;
}
