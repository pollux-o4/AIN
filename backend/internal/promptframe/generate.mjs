// Capture the Node reference prompt frame (team, role briefs, guards) shared by every Go prompt assembler.
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const root = resolve(process.argv[2] ?? ".");
const fromRoot = (path) => import(pathToFileURL(resolve(root, path)));
const { frame, GUARD } = await fromRoot("automation/paseo/prompts/frame.mjs");
const { STAGE_ROLES } = await fromRoot("automation/paseo/roles.mjs");

const roles = {};
let team;
for (const role of new Set(Object.values(STAGE_ROLES))) {
  const lines = frame({ id: "example", role, task: "task", example: {}, data: {} }).split("\n");
  [, , team, roles[role]] = lines;
}
const payload = { team, roles, guard: GUARD, stageRoles: STAGE_ROLES };
writeFileSync(new URL("./frame.json", import.meta.url), `${JSON.stringify(payload, null, 2)}\n`);
