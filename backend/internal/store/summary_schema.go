package store

const summaryValues = `
	COALESCE(CAST(json_extract(value, '$.state.status') AS TEXT), ''),
	COALESCE(substr(json_extract(value, '$.state.idea'), 1, 101), ''),
	COALESCE(json_extract(value, '$.state.revision'), 0),
	COALESCE(CAST(json_extract(value, '$.updatedAt') AS TEXT), ''),
	CASE WHEN json_type(value, '$.archivedAt') IN ('integer', 'real', 'text', 'true')
		AND json_extract(value, '$.archivedAt') NOT IN (0, '') THEN 1 ELSE 0 END`

const refreshSummary = `
	INSERT INTO ain_run_summaries(sequence, id, status, idea, revision, updated_at, archived)
	SELECT NEW.rowid, NEW.id, ` + summaryValues + ` FROM (SELECT NEW.value AS value) WHERE true
	ON CONFLICT(sequence) DO UPDATE SET id=excluded.id,status=excluded.status,idea=excluded.idea,
		revision=excluded.revision,updated_at=excluded.updated_at,archived=excluded.archived;`

const summaryMigration = `
	CREATE TABLE ain_run_summaries (
		sequence INTEGER PRIMARY KEY,
		id TEXT NOT NULL,
		status TEXT NOT NULL,
		idea TEXT NOT NULL,
		revision INTEGER NOT NULL,
		updated_at TEXT NOT NULL,
		archived INTEGER NOT NULL
	);
	INSERT INTO ain_run_summaries
	SELECT rowid, id, ` + summaryValues + ` FROM editorial_runs;
	CREATE TRIGGER ain_summary_insert AFTER INSERT ON editorial_runs BEGIN` + refreshSummary + ` END;
	CREATE TRIGGER ain_summary_update AFTER UPDATE OF value ON editorial_runs BEGIN` + refreshSummary + ` END;
	CREATE TRIGGER ain_summary_delete AFTER DELETE ON editorial_runs BEGIN
		DELETE FROM ain_run_summaries WHERE sequence = OLD.rowid;
	END;`
