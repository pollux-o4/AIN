package main

import (
	"context"
	"errors"
	"log"

	"github.com/pollux-o4/AIN/backend/internal/contract"
	"github.com/pollux-o4/AIN/backend/internal/editorial"
)

func reportExecution(id string, err error) {
	var kind string
	switch {
	case errors.Is(err, contract.ErrDeliveryUncertain):
		kind = "remote_state_unconfirmed"
	case errors.Is(err, editorial.ErrBudget):
		kind = "budget_exhausted"
	case errors.Is(err, context.DeadlineExceeded):
		kind = "deadline"
	case errors.Is(err, contract.ErrConflict):
		kind = "version_conflict"
	default:
		kind = "execution_error"
	}
	// Errors from the provider may include inputs or response bodies.
	log.Printf("editorial execution kind=%s run=%q", kind, id)
}
