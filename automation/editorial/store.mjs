import { chmodSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";

export class EditorialStore {
  // shortcut: 상태·revision 이력 JSON 저장, 원고·이력이 커지는 장기 운영 전 이력 분리·목록 조회 최적화 검토
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
