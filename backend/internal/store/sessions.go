package store

import (
	"context"

	"github.com/pollux-o4/AIN/backend/internal/sessions"
)

// SessionRegistry shares the private editorial database's lifetime.
func (s *SQLite) SessionRegistry(ctx context.Context) (*sessions.Registry, error) {
	return sessions.NewRegistry(ctx, s.db)
}
