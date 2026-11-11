import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const root = resolve(".local/ai-runtime");
await mkdir(root, { recursive: true, mode: 0o700 });
const tokenPath = join(root, "bridge-token");
try {
  await writeFile(tokenPath, randomBytes(32).toString("hex"), { flag: "wx", mode: 0o600 });
} catch (e) {
  if (e.code !== "EEXIST") throw e;
}
const token = (await readFile(tokenPath, "utf8")).trim();
await writeFile(
  join(root, "n8n-credentials.json"),
  JSON.stringify([
    {
      id: "localPaseoBridge",
      name: "Local Paseo bridge",
      type: "httpHeaderAuth",
      data: { name: "Authorization", value: `Bearer ${token}` },
    },
  ]),
  { mode: 0o600 },
);
console.log("Private AIN bridge credential prepared; shared Paseo runtime unchanged");
