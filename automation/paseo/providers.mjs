import { resolve } from "node:path";
import { connectLocalPaseo } from "../../../paseo/sdk.mjs";

const client = await connectLocalPaseo();
try {
  const { entries } = await client.providers.waitForReady({ cwd: resolve("."), timeoutMs: 15000 });
  for (const provider of entries) {
    console.log(`${provider.provider}: ${provider.status}`);
    for (const model of provider.models ?? [])
      console.log(`  ${model.id}${model.isDefault ? " [default]" : ""}`);
  }
} finally {
  await client.close();
}
