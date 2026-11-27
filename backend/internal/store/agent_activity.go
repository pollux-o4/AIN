package store

import "context"

// Each lookup uses a partial index over unresolved work. The parent check
// fences batch children whose parent has already completed.
const activeAgentQuery = `SELECT EXISTS (
	SELECT 1 FROM ain_intents INDEXED BY ain_pending_agent WHERE completed=0 AND agent_id=?1
	UNION ALL
	SELECT 1 FROM ain_intents INDEXED BY ain_pending_remote_agent WHERE completed=0 AND remote_agent_id=?1
	UNION ALL
	SELECT 1 FROM ain_batch_children AS c INDEXED BY ain_running_child_agent
	JOIN ain_intents AS p ON p.id=c.parent_id
	WHERE c.state=1 AND c.agent_id=?1 AND p.completed=0
		AND p.agent_id='' AND p.remote_agent_id=''
	UNION ALL
	SELECT 1 FROM ain_batch_children AS c INDEXED BY ain_running_child_remote_agent
	JOIN ain_intents AS p ON p.id=c.parent_id
	WHERE c.state=1 AND c.remote_agent_id=?1 AND p.completed=0
		AND p.agent_id='' AND p.remote_agent_id=''
)`

const agentActivityMigration = `
	CREATE INDEX ain_pending_agent ON ain_intents(agent_id) WHERE completed=0;
	CREATE INDEX ain_pending_remote_agent ON ain_intents(remote_agent_id) WHERE completed=0;
	CREATE INDEX ain_running_child_agent ON ain_batch_children(agent_id) WHERE state=1;
	CREATE INDEX ain_running_child_remote_agent ON ain_batch_children(remote_agent_id) WHERE state=1;
`

// IsAgentActive checks the durable activity of one agent without reading
// prompts, turn results, or a snapshot taken before the sweep began.
func (s *SQLite) IsAgentActive(ctx context.Context, id string) (bool, error) {
	if id == "" {
		return false, nil
	}
	var active bool
	err := s.db.QueryRowContext(ctx, activeAgentQuery, id).Scan(&active)
	return active, err
}
