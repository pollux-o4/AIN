package main

import (
	"os"

	"github.com/pollux-o4/AIN/backend/internal/datalock"
)

func lockData(root string) (*os.File, error) {
	return datalock.Acquire(root)
}
