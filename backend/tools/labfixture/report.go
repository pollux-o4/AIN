package main

import (
	"context"
	"encoding/json"

	"github.com/pollux-o4/AIN/backend/internal/contract"
)

type activity struct {
	At    int64               `json:"at"`
	Kind  string              `json:"kind"`
	Stage string              `json:"stage"`
	JobID string              `json:"jobId"`
	Usage *contract.TurnUsage `json:"usage,omitempty"`
}

type layer struct {
	Figure string              `json:"figure"`
	Parent string              `json:"parent"`
	Usage  *contract.TurnUsage `json:"usage,omitempty"`
}

type report struct {
	Lab    *provenance     `json:"lab"`
	Figure json.RawMessage `json:"figure"`
	Events []activity      `json:"events"`
	Layers []layer         `json:"layers"`
}

func makeReport(ctx context.Context, db reader, id string, record json.RawMessage) (report, error) {
	var saved struct {
		Lab    *provenance
		State  struct{ Figure json.RawMessage }
		Events []activity
	}
	if err := json.Unmarshal(record, &saved); err != nil {
		return report{}, err
	}
	value := report{Lab: saved.Lab, Figure: saved.State.Figure, Events: []activity{}, Layers: []layer{}}
	for _, event := range saved.Events {
		if event.JobID != "" && (event.Kind == "ai_requested" || event.Kind == "ai_completed") &&
			(event.Stage == "figure_plan" || event.Stage == "figure_compose" || event.Stage == "figure") {
			value.Events = append(value.Events, event)
		}
	}
	rows, err := db.QueryContext(ctx, `SELECT child.parent_id, child.result
		FROM ain_batch_children child JOIN ain_intents intent ON child.parent_id = intent.id
		WHERE intent.run_id = ? AND intent.completed = 1 AND child.state = 2 AND child.result IS NOT NULL
		ORDER BY intent.sequence, child.position`, id)
	if err != nil {
		return report{}, err
	}
	defer rows.Close()
	for rows.Next() {
		var item layer
		var raw string
		if err := rows.Scan(&item.Parent, &raw); err != nil {
			return report{}, err
		}
		var event contract.Event
		if err := json.Unmarshal([]byte(raw), &event); err != nil {
			return report{}, err
		}
		var body struct{ FigureID string }
		if err := json.Unmarshal(event.Body, &body); err != nil {
			return report{}, err
		}
		if event.Kind == "figure_result" && event.Actor == "adapter" && body.FigureID != "" {
			item.Figure = body.FigureID
			if event.Usage.Valid() {
				item.Usage = event.Usage
			}
			value.Layers = append(value.Layers, item)
		}
	}
	return value, rows.Err()
}
