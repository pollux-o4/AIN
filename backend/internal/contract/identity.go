package contract

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
)

// IntentID identifies a planned transition. A run version is the durable fence
// that distinguishes an explicit retry or a later turn from duplicate wakes.
func IntentID(run Run, action Action) string {
	parts := struct {
		RunID    string
		Version  int64
		Kind     string
		Stage    string
		FigureID string
	}{run.ID, run.Version, action.Kind, action.Stage, action.FigureID}
	encoded, err := json.Marshal(parts)
	if err != nil {
		// The struct contains only scalars supported by encoding/json.
		panic(err)
	}
	hash := sha256.Sum256(encoded)
	return hex.EncodeToString(hash[:])
}
