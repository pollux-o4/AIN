package main

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/pollux-o4/AIN/backend/internal/contract"
)

type articleFixture struct {
	wire
	mu       sync.Mutex
	byStage  map[string]string
	agents   map[string]articleFixtureAgent
	archives int
}

type articleFixtureAgent struct {
	spec contract.SessionSpec
	body json.RawMessage
}

func (f *articleFixture) Create(_ context.Context, id string, spec contract.SessionSpec) (contract.RemoteRef, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	header, _, _ := strings.Cut(spec.Prompt, "\n")
	stage := strings.TrimSuffix(strings.TrimPrefix(header, "[과업 ID: "), "]")
	result := f.byStage[stage]
	if result == "" {
		return contract.RemoteRef{}, errors.New("unsupported fixture stage " + stage)
	}
	body, _ := json.Marshal(map[string]string{"daemonTurnId": "fixture-" + id, "text": result})
	f.agents[id] = articleFixtureAgent{spec: spec, body: body}
	return contract.RemoteRef{AgentID: id, TurnID: id, Epoch: "fixture-epoch", After: 3}, nil
}

func (f *articleFixture) Snapshot(_ context.Context, ref contract.RemoteRef) (contract.Snapshot, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	agent, ok := f.agents[ref.AgentID]
	if !ok {
		return contract.Snapshot{}, contract.ErrNotFound
	}
	ref.Epoch, ref.After = "fixture-epoch", 3
	if ref.TurnID == ref.AgentID {
		return contract.Snapshot{Ref: ref, Status: "completed", Body: agent.body}, nil
	}
	if ref.TurnID != "" {
		return contract.Snapshot{}, contract.ErrNotFound
	}
	body, _ := json.Marshal(map[string]any{"agent": map[string]any{
		"id": ref.AgentID, "labels": agent.spec.Labels, "status": "idle", "activeTurn": nil,
		"provider": agent.spec.Provider, "model": agent.spec.Model, "currentModeId": agent.spec.Mode, "thinkingOptionId": agent.spec.Thinking,
	}})
	return contract.Snapshot{Ref: ref, Status: "idle", Body: body}, nil
}

func (f *articleFixture) Archive(_ context.Context, ref contract.RemoteRef) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	delete(f.agents, ref.AgentID)
	f.archives++
	return nil
}

func TestArticleUsesGoAPIWithEightStageFixture(t *testing.T) {
	data, err := os.ReadFile("../../../tests/migration/reference/flow-001.json")
	if err != nil {
		t.Fatal(err)
	}
	var flows []struct {
		Event struct {
			Type     string
			Stage    string
			Revision int
			Output   json.RawMessage
		}
	}
	if err := json.Unmarshal(data, &flows); err != nil {
		t.Fatal(err)
	}
	fixture := &articleFixture{byStage: make(map[string]string), agents: make(map[string]articleFixtureAgent)}
	for _, flow := range flows {
		if e := flow.Event; e.Type == "complete" && e.Revision == 1 {
			fixture.byStage[e.Stage] = string(e.Output)
		}
	}
	root := t.TempDir()
	if err := os.Chmod(root, 0o700); err != nil {
		t.Fatal(err)
	}
	request := model{Provider: "fixture", Model: "synthetic"}
	cfg := config{Root: root, Standard: request, High: request,
		Input: json.RawMessage(`{"requestId":"fixture-request","idea":"접속 장애에서 배운 점","source":"합성 원문"}`)}
	report := &probeReport{}
	ctx, cancel := context.WithTimeout(t.Context(), 10*time.Second)
	defer cancel()
	if err := article(ctx, fixture, cfg, "", report); err != nil {
		t.Fatalf("%v, report: %+v", err, report)
	}
	if report.ArticleCalls != 8 || report.Created != 8 || report.Reused != 0 || len(report.CleanupIssues) != 0 || fixture.archives != 8 {
		t.Fatalf("eight-stage article or cleanup did not complete: report=%+v archived=%d", report, fixture.archives)
	}
}
