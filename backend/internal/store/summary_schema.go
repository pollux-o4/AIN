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

// Only select the manuscript a reader sees. An empty current manuscript is
// still authoritative. History contributes the last draft with textual output.
const displayedDraft = `COALESCE(
	CASE WHEN json_type(source.value, '$.state.artifacts.draft.output.text') = 'text'
		THEN json_extract(source.value, '$.state.artifacts.draft.output.text') END,
	(SELECT json_extract(item.value, '$.artifacts.draft.output.text')
	FROM json_each(source.value, '$.state.history') AS item
	WHERE CASE WHEN item.type = 'object' THEN json_type(item.value, '$.artifacts.draft.output.text') END = 'text'
	ORDER BY CAST(item.key AS INTEGER) DESC LIMIT 1),
	'')`

// Match the Node title pattern for manuscript headings without requiring a
// connection-local regexp function. Node can update the same database on
// rollback. At most 101 Unicode code points travel to the list projection.
const listHeading = `COALESCE((WITH RECURSIVE
	whitespace(chars) AS (
		SELECT char(9,10,11,12,13,32,160,5760,8192,8193,8194,8195,8196,8197,8198,8199,8200,8201,8202,8232,8233,8239,8287,12288,65279)
	), draft(body) AS (
		SELECT replace(replace(replace(` + displayedDraft + `,char(13),char(10)),char(8232),char(10)),char(8233),char(10))
	), headings(rest) AS (
		SELECT CASE WHEN substr(body,1,1) = '#' THEN body
			WHEN instr(body,char(10)||'#') > 0 THEN substr(body,instr(body,char(10)||'#')+1)
			ELSE '' END FROM draft
		UNION ALL
		SELECT substr(rest,instr(rest,char(10)||'#')+1)
		FROM headings WHERE instr(rest,char(10)||'#') > 0
	), matches(title) AS (
		SELECT ltrim(substr(rest,2),chars)
		FROM headings, whitespace
		WHERE substr(rest,2,1) <> '' AND instr(chars,substr(rest,2,1)) > 0
	)
	SELECT substr(CASE WHEN instr(title,char(10)) > 0
		THEN substr(title,1,instr(title,char(10))-1) ELSE title END,1,101)
	FROM matches WHERE title <> '' LIMIT 1),'')`

// Persist only data used by monitor labels. In particular figures, artifact
// text, issue text and private worker data must never enter the list cache.
const summaryMonitor = `CASE WHEN json_type(value,'$.state.stage') = 'text' THEN json_object(
	'state', json_object(
		'stage', coalesce(json_extract(value,'$.state.stage'),''),
		'status', coalesce(json_extract(value,'$.state.status'),''),
		'resumeStatus', coalesce(json_extract(value,'$.state.resumeStatus'),''),
		'figure', CASE WHEN json_type(value,'$.state.figure') = 'object' THEN json_object(
			'phase',json_extract(value,'$.state.figure.phase'),
			'current',json_object(
				'id',json_extract(value,'$.state.figure.current.id'),
				'ids',json_extract(value,'$.state.figure.current.ids'),
				'pass',json_extract(value,'$.state.figure.current.pass')),
			'selected',json_extract(value,'$.state.figure.selected')) END),
	'pending', json_object('jobId',coalesce(json_extract(value,'$.pending.jobId'),'')),
	'worker', json_object('confirmedAt',json_extract(value,'$.worker.confirmedAt')),
	'queuedAt',json_extract(value,'$.queuedAt'),
	'startedAt',json_extract(value,'$.startedAt'),
	'issue',CASE WHEN json_type(value,'$.issue') NOT IN ('null','false')
		AND json_extract(value,'$.issue') NOT IN (0,'') THEN '확인 필요' END,
	'issueKind',json_extract(value,'$.issueKind')) ELSE '' END`

const refreshListSummary = `
	INSERT INTO ain_run_summaries(sequence,id,status,idea,revision,updated_at,archived,title,monitor)
	SELECT NEW.rowid,NEW.id,` + summaryValues + `,` + listHeading + `,` + summaryMonitor + `
	FROM (SELECT NEW.value AS value) AS source WHERE true
	ON CONFLICT(sequence) DO UPDATE SET id=excluded.id,status=excluded.status,idea=excluded.idea,
		revision=excluded.revision,updated_at=excluded.updated_at,archived=excluded.archived,
		title=excluded.title,monitor=excluded.monitor,needs_completion=NULL;`

const listSummaryMigration = `
	ALTER TABLE ain_run_summaries ADD COLUMN title TEXT NOT NULL DEFAULT '';
	ALTER TABLE ain_run_summaries ADD COLUMN monitor TEXT NOT NULL DEFAULT '';
	ALTER TABLE ain_run_summaries ADD COLUMN needs_completion INTEGER;
	CREATE INDEX ain_summary_dirty ON ain_run_summaries(sequence)
		WHERE needs_completion IS NULL AND archived=0 AND monitor <> '';
	UPDATE ain_run_summaries
	SET (title, monitor) = (SELECT ` + listHeading + `, ` + summaryMonitor + `
		FROM editorial_runs AS source WHERE source.rowid = ain_run_summaries.sequence);
	DROP TRIGGER ain_summary_insert;
	DROP TRIGGER ain_summary_update;
	CREATE TRIGGER ain_summary_insert AFTER INSERT ON editorial_runs BEGIN` + refreshListSummary + ` END;
	CREATE TRIGGER ain_summary_update AFTER UPDATE OF value ON editorial_runs BEGIN` + refreshListSummary + ` END;`
