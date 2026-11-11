import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";

// AIN-API-001: product source must not import or configure a consuming repository.
test("AIN-API-001: independent source boundary", async () => {
  const forbidden = new RegExp(["My", "Blog"].join(""), "i");
  async function check(root) {
    for (const item of await readdir(root, { withFileTypes: true })) {
      const path = join(root, item.name);
      if (item.isDirectory()) await check(path);
      else if (/\.(mjs|js|ts|tsx|html|json|md|toml)$/.test(path)) {
        const content = await readFile(path, "utf8");
        assert.equal(forbidden.test(content), false, `Consumer reference: ${path}`);
        assert.equal(/(?:import|from)\s*["'].*(?:content|cms|skins)\//.test(content), false, path);
      }
    }
  }
  await check("automation");
  await check("docs");
});
