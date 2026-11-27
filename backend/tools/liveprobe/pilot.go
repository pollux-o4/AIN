package main

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"slices"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/pollux-o4/AIN/backend/internal/contract"
	"github.com/pollux-o4/AIN/backend/internal/sessions"
)

type wire interface {
	contract.Paseo
	sessions.Wire
	Providers(context.Context, string) (json.RawMessage, error)
}

func runProbe(ctx context.Context, client wire, cfg config, report *probeReport) error {
	check, cancel := context.WithTimeout(ctx, 15*time.Second)
	mode, err := modelReady(check, client, cfg)
	cancel()
	if err != nil {
		return err
	}
	if cfg.Pilot {
		report.Phase = "pilot"
		if err := pilot(ctx, client, cfg, mode, report); err != nil {
			return err
		}
	}
	if cfg.Article {
		report.Phase = "article"
		if err := article(ctx, client, cfg, mode, report); err != nil {
			return err
		}
	}
	report.Phase = "complete"
	return nil
}

func modelReady(ctx context.Context, client wire, cfg config) (string, error) {
	payload, err := client.Providers(ctx, cfg.Root)
	if err != nil {
		return "", errors.New("기본 제공자 연결을 확인하지 못했습니다.")
	}
	var catalog struct {
		Entries []struct {
			Provider string `json:"provider"`
			Status   string `json:"status"`
			Mode     string `json:"defaultModeId"`
			Models   []struct {
				ID string `json:"id"`
			} `json:"models"`
		} `json:"entries"`
	}
	if json.Unmarshal(payload, &catalog) != nil {
		return "", errors.New("기본 제공자 목록을 읽지 못했습니다.")
	}
	for _, item := range catalog.Entries {
		if item.Provider == cfg.Standard.Provider && item.Status == "ready" &&
			slices.ContainsFunc(item.Models, func(m struct {
				ID string `json:"id"`
			}) bool {
				return m.ID == cfg.Standard.Model
			}) {
			return item.Mode, nil
		}
	}
	return "", errors.New("기본 제공자·모델 연결을 먼저 확인해 주세요.")
}

func pilot(parent context.Context, client wire, cfg config, mode string, report *probeReport) error {
	id := uuid.NewString()
	marker := "contract-pilot-" + uuid.NewString()
	ref := contract.RemoteRef{AgentID: id, TurnID: id}
	if err := writePrivate(cfg.Root, "pilot-intent.json", ref); err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(parent, 90*time.Second)
	defer cancel()
	cleaned := false
	defer func() {
		if cleaned {
			return
		}
		cleanup, done := context.WithTimeout(context.WithoutCancel(parent), 10*time.Second)
		defer done()
		if err := settlePilot(cleanup, client, ref); err != nil {
			report.CleanupIssues = append(report.CleanupIssues, "pilot_stop_unconfirmed")
		}
	}()
	if err := ctx.Err(); err != nil {
		return err
	}
	report.PilotCalls++
	prompt := fmt.Sprintf("실행 연결만 확인합니다. 도구, 파일, 쉘, 다른 에이전트는 쓰지 마세요. 부가 설명 없이 이 JSON 객체 하나만 반환하세요. {\"marker\":%q}", marker)
	ack, err := client.Create(ctx, id, contract.SessionSpec{
		Provider: cfg.Standard.Provider, Model: cfg.Standard.Model, Thinking: cfg.Standard.Thinking, Mode: mode,
		WorkDir: cfg.Root, Prompt: prompt, Labels: map[string]string{"source": "ain-go-live", "owner": cfg.Root, "job": id},
	})
	if err == nil && (ack.AgentID != id || ack.TurnID != id) {
		return contract.ErrDeliveryUncertain
	}
	// An acknowledgement can be lost. Reconcile the one allocated ID and
	// never resend the prompt or create a fallback agent.
	result, err := pollPilot(ctx, client, ref)
	if err != nil {
		return errors.New("연결 확인 실패: 글 실행을 시작하지 않습니다.")
	}
	var turn struct {
		DaemonTurnID string `json:"daemonTurnId"`
		Text         string `json:"text"`
	}
	if json.Unmarshal(result.Body, &turn) != nil || turn.DaemonTurnID == "" || result.Status != "completed" {
		return errors.New("연결 확인 결과가 확정되지 않았습니다.")
	}
	var reply struct{ Marker string }
	text := strings.TrimSpace(turn.Text)
	if strings.HasPrefix(text, "```json\n") && strings.HasSuffix(text, "\n```") {
		text = strings.TrimSpace(text[len("```json\n") : len(text)-len("\n```")])
	}
	if json.Unmarshal([]byte(text), &reply) != nil || reply.Marker != marker {
		return errors.New("연결 확인 응답의 식별자가 일치하지 않습니다.")
	}
	if err := settlePilot(ctx, client, ref); err != nil {
		return errors.New("연결 확인 세션 보관을 확인하지 못했습니다.")
	}
	cleaned = true
	return nil
}

func pollPilot(ctx context.Context, client wire, ref contract.RemoteRef) (contract.Snapshot, error) {
	ticker := time.NewTicker(500 * time.Millisecond)
	defer ticker.Stop()
	for {
		got, err := client.Snapshot(ctx, ref)
		if err == nil {
			if got.Ref.AgentID != ref.AgentID || (got.Ref.TurnID != "" && got.Ref.TurnID != ref.TurnID) {
				return got, contract.ErrDeliveryUncertain
			}
			if isTerminal(got.Status) && got.Ref.TurnID == ref.TurnID {
				return got, nil
			}
		} else if !errors.Is(err, contract.ErrNotFound) {
			return got, err
		}
		select {
		case <-ctx.Done():
			return contract.Snapshot{}, ctx.Err()
		case <-ticker.C:
		}
	}
}

func isTerminal(s string) bool {
	return s == "completed" || s == "failed" || s == "stopped" || s == "cancelled"
}

func settlePilot(ctx context.Context, client wire, ref contract.RemoteRef) error {
	meta, err := client.Snapshot(ctx, contract.RemoteRef{AgentID: ref.AgentID})
	if err != nil {
		return err
	}
	if archived(meta) {
		return nil
	}
	got, err := client.Snapshot(ctx, ref)
	if err != nil || got.Ref.AgentID != ref.AgentID || got.Ref.TurnID != ref.TurnID {
		return contract.ErrDeliveryUncertain
	}
	if !isTerminal(got.Status) {
		if err := client.Cancel(ctx, got.Ref); err != nil {
			return err
		}
		got, err = pollPilot(ctx, client, ref)
		if err != nil || !isTerminal(got.Status) {
			return contract.ErrDeliveryUncertain
		}
	}
	if err := client.Archive(ctx, ref); err != nil {
		return err
	}
	checked, err := client.Snapshot(ctx, contract.RemoteRef{AgentID: ref.AgentID})
	if errors.Is(err, contract.ErrNotFound) || err == nil && archived(checked) {
		return nil
	}
	return contract.ErrDeliveryUncertain
}

func archived(snapshot contract.Snapshot) bool {
	var value struct {
		Agent struct {
			ArchivedAt string `json:"archivedAt"`
		} `json:"agent"`
	}
	return json.Unmarshal(snapshot.Body, &value) == nil && value.Agent.ArchivedAt != ""
}
