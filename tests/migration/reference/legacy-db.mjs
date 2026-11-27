import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { EditorialStore } from "../../../automation/editorial/store.mjs";

const directory = process.argv[2];
if (!directory) throw new Error("An empty fixture output directory is required");
mkdirSync(directory, { mode: 0o700 });
const cases = JSON.parse(readFileSync(new URL("./flow-001.json", import.meta.url)));
const initial = cases.find(({ name }) => name === "start").state;
const completed = cases.find(({ name }) => name === "first completion").state;
const store = new EditorialStore(join(directory, "editorial.sqlite"));

try {
  store.save({
    id: initial.articleId,
    requestId: "request-1",
    state: initial,
    pending: { jobId: "a".repeat(64) },
    futureMetadata: { untouched: true },
  });
  store.save({
    id: "migration-archive",
    requestId: "request-archive",
    state: { ...completed, articleId: "migration-archive" },
    archivedAt: "2026-11-01T00:00:00.000Z",
  });
} finally {
  store.close();
}
