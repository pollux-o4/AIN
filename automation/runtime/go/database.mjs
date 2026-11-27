import { lstatSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

function visit(data, query) {
  const path = join(data, "editorial.sqlite");
  try {
    const file = lstatSync(path);
    if (!file.isFile() || (file.mode & 0o077) !== 0)
      throw Error("편집 DB는 비공개 일반 파일이어야 합니다.");
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
  const db = new DatabaseSync(path, { readOnly: true, timeout: 3000 });
  try {
    const names = new Set(
      db
        .prepare("SELECT name FROM sqlite_schema WHERE type = 'table'")
        .all()
        .map(({ name }) => name),
    );
    return query(db, names);
  } finally {
    db.close();
  }
}

export function assertGoData(data) {
  const legacy = visit(data, (db, tables) => {
    if (!tables.has("editorial_runs")) return false;
    if (!tables.has("ain_schema_migrations")) return true;
    return Boolean(
      db
        .prepare(`SELECT 1 FROM editorial_runs
      WHERE json_type(value, '$.pending') = 'object'
      AND COALESCE(json_extract(value, '$.issueKind'), '') <> 'legacy_reconcile' LIMIT 1`)
        .get(),
    );
  });
  if (legacy)
    throw Error(
      "이전 편집 DB를 바로 사용하지 않습니다. MIG-053 오프라인 이관 후 AIN_DATA_DIR에 검증한 후보 경로를 지정해 주세요.",
    );
}

export function assertLegacyData(data) {
  if (visit(data, (_db, tables) => tables.has("ain_schema_migrations")))
    throw Error("Go 편집 DB는 이전 Node 서비스에서 열 수 없습니다. 별도 복구본을 사용해 주세요.");
}

export function activeIntents(data) {
  return (
    visit(data, (db, tables) =>
      tables.has("ain_intents")
        ? db.prepare("SELECT count(*) AS count FROM ain_intents WHERE completed = 0").get().count
        : 0,
    ) ?? 0
  );
}
