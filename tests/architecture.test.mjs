import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { promisify } from "node:util";

const execute = promisify(execFile);
test("ARCH-001: real dependency checker rejects inverted layers and private imports", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "ain-architecture-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const files = {
    "automation/editorial/domain/index.mjs": "export const domain = true;",
    "automation/editorial/domain/probe.mjs": "export const pure = true;",
    "automation/editorial/index.mjs": 'export { app } from "./service.mjs";',
    "automation/editorial/service.mjs":
      'import { domain } from "./domain/index.mjs"; export const app = domain;',
    "automation/paseo/index.mjs": 'export { driver } from "./jobs.mjs";',
    "automation/paseo/jobs.mjs":
      'import { domain } from "../editorial/domain/index.mjs"; export const driver = domain;',
    "automation/editorial/ui/main.mjs": "export const view = true;",
    "automation/n8n/workflow.mjs": "export const transport = true;",
  };
  async function put(path, content) {
    const file = join(root, path);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, content);
  }
  for (const [path, content] of Object.entries(files)) await put(path, content);
  await put(
    "config.cjs",
    `const config = require(${JSON.stringify(resolve(".dependency-cruiser.cjs"))}); module.exports = {...config, options: {...config.options, tsConfig: undefined}};`,
  );
  const binary = resolve("node_modules/.bin/depcruise");
  const args = ["automation", "--config", "config.cjs", "--output-type", "json"];
  const options = { cwd: root, timeout: 30000, maxBuffer: 5 * 1024 * 1024 };
  const allowed = JSON.parse((await execute(binary, args, options)).stdout);
  assert.equal(allowed.summary.violations.length, 0);

  await put("automation/editorial/domain/probe.mjs", 'import "node:fs"; import "../service.mjs";');
  await put(
    "automation/editorial/service.mjs",
    'import "../paseo/jobs.mjs"; export const app = true;',
  );
  await put(
    "automation/paseo/jobs.mjs",
    'import "../editorial/service.mjs"; export const driver = true;',
  );
  await put("automation/editorial/ui/main.mjs", 'import "../service.mjs";');
  await put("automation/n8n/workflow.mjs", 'import "../editorial/domain/index.mjs";');
  const rejected = JSON.parse((await execute(binary, args, options)).stdout);
  assert.ok(
    rejected.summary.advisedExitCode > 0,
    "Inverted module dependencies must fail validation",
  );
  const violations = new Set(rejected.summary.violations.map((item) => item.rule.name));
  for (const rule of [
    "domain-no-io",
    "domain-no-adapters",
    "editorial-no-execution-adapters",
    "editorial-public-interface-only",
    "paseo-public-interface-only",
    "browser-no-runtime",
    "n8n-no-business-policies",
  ])
    assert.ok(violations.has(rule), `Missing enforcement: ${rule}`);
});
