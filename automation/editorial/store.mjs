import { chmodSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { PENDING_STATUSES } from "../contracts/status.mjs";

// 글 기록은 한 건이 수 MB라 목록 판단은 SQL이 필요한 칸만 뽑는다 · 전체 파싱은 메모리 고갈
const PENDING_SQL = `SELECT id, json_extract(value, '$.state.status') AS status,
  json_extract(value, '$.state.idea') AS idea, json_extract(value, '$.issue') AS issue
  FROM editorial_runs WHERE json_extract(value, '$.state.status') IN (${PENDING_STATUSES.map(() => "?").join(",")})`;

/** 대기 상태 글 요약 · 서비스와 기동 제어가 같은 질의를 쓴다 @param {DatabaseSync} db */
export const pendingRuns = (db) =>
  db
    .prepare(PENDING_SQL)
    .all(...PENDING_STATUSES)
    .map(({ id, status, idea, issue }) => ({ id, issue, state: { status, idea } }));

export class EditorialStore {
  // shortcut: 상태·revision 이력을 한 JSON에 저장(한 건 수 MB), 기록이 더 커지면 이력 분리 검토
  constructor(path) {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(path);
    chmodSync(path, 0o600);
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS editorial_runs (
        id TEXT PRIMARY KEY, request_id TEXT UNIQUE NOT NULL, value TEXT NOT NULL
      );`);
  }
  get(id) {
    const row = this.db.prepare("SELECT value FROM editorial_runs WHERE id=?").get(id);
    if (!row) throw Object.assign(new Error("글쓰기 작업을 찾을 수 없습니다."), { status: 404 });
    return JSON.parse(row.value);
  }
  find(requestId) {
    const row = this.db
      .prepare("SELECT value FROM editorial_runs WHERE request_id=?")
      .get(requestId);
    return row ? JSON.parse(row.value) : null;
  }
  save(run) {
    this.db
      .prepare(`INSERT INTO editorial_runs VALUES (?,?,?)
      ON CONFLICT(id) DO UPDATE SET value=excluded.value`)
      .run(run.id, run.requestId, JSON.stringify(run));
    return run;
  }
  pending() {
    return pendingRuns(this.db);
  }
  /** @param {string} prefix */
  findByPrefix(prefix) {
    return this.db
      .prepare("SELECT value FROM editorial_runs WHERE id LIKE ? ESCAPE '\\'")
      .all(`${prefix.replace(/[\\%_]/g, "\\$&")}%`)
      .map((r) => JSON.parse(r.value));
  }
  // 목록용 변경 표식 · 값 전체를 파싱하지 않는다
  stamps() {
    return this.db
      .prepare(`SELECT id, json_extract(value, '$.updatedAt') AS updatedAt,
        json_extract(value, '$.archivedAt') AS archivedAt,
        json_extract(value, '$.state.status') AS status FROM editorial_runs`)
      .all();
  }
  list() {
    return this.db
      .prepare("SELECT value FROM editorial_runs ORDER BY rowid DESC")
      .all()
      .map((r) => JSON.parse(r.value));
  }
  close() {
    this.db.close();
  }
}
