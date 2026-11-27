package store

import (
	"path/filepath"
	"strings"
	"testing"
)

func TestAgentActivityUsesPendingAndRunningIndexes(t *testing.T) {
	ctx := t.Context()
	s, err := Open(ctx, filepath.Join(t.TempDir(), "private", "editorial.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	if _, err := s.db.ExecContext(ctx, `
		INSERT INTO editorial_runs VALUES ('run', 'request', '{}');
		INSERT INTO ain_intents
		(id, run_id, agent_id, action, deadline, remote_agent_id, remote_turn_id, remote_epoch, remote_after, completed)
		VALUES ('single','run','local','{}','','remote','','',0,0),
		       ('batch','run','','{}','','','','',0,1);
		INSERT INTO ain_batch_children
		(position,id,parent_id,agent_id,action,deadline,remote_agent_id,state)
		VALUES (0,'child','batch','child-local','{}','','child-remote',1),
		       (1,'queued','batch','queued','{}','','',0);
	`); err != nil {
		t.Fatal(err)
	}
	check := func(id string, want bool) {
		t.Helper()
		got, err := s.IsAgentActive(ctx, id)
		if err != nil || got != want {
			t.Fatalf("agent %q: got %v, want %v, err %v", id, got, want, err)
		}
	}
	check("local", true)
	check("remote", true)
	check("child-local", false)
	if _, err := s.db.ExecContext(ctx, `UPDATE ain_intents SET completed=1 WHERE id='single';
		UPDATE ain_intents SET completed=0 WHERE id='batch'`); err != nil {
		t.Fatal(err)
	}
	check("local", false)
	check("child-local", true)
	check("child-remote", true)
	check("queued", false)
	check("", false)
	rows, err := s.db.QueryContext(ctx, "EXPLAIN QUERY PLAN "+activeAgentQuery, "absent")
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	var searches int
	for rows.Next() {
		var id, parent, unused int
		var detail string
		if err := rows.Scan(&id, &parent, &unused, &detail); err != nil {
			t.Fatal(err)
		}
		if strings.HasPrefix(detail, "SEARCH ") && strings.Contains(detail, "agent") {
			searches++
		}
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	if searches != 4 {
		t.Fatalf("expected four indexed agent lookups, got %d", searches)
	}
}
