// Command providers prints a read-only Paseo provider snapshot.
package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"os"
	"time"

	"github.com/pollux-o4/AIN/backend/internal/paseowire"
)

func main() {
	home := flag.String("paseo-home", os.Getenv("PASEO_HOME"), "local Paseo home")
	cwd := flag.String("cwd", "", "workspace for provider discovery")
	flag.Parse()
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	err := listProviders(ctx, *home, *cwd)
	cancel()
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

type providerSnapshot struct {
	Entries []struct {
		Provider string
		Status   string
		Models   []struct {
			ID        string
			IsDefault bool
		}
	}
}

func listProviders(ctx context.Context, home, cwd string) error {
	if home == "" {
		return fmt.Errorf("set PASEO_HOME or pass --paseo-home")
	}
	if cwd == "" {
		var err error
		cwd, err = os.Getwd()
		if err != nil {
			return err
		}
	}
	client := paseowire.New(home)
	tick := time.NewTicker(time.Second)
	defer tick.Stop()
	var last providerSnapshot
	for {
		payload, err := client.Providers(ctx, cwd)
		if err != nil {
			if ctx.Err() != nil && last.Entries != nil {
				return printSnapshot(os.Stdout, last)
			}
			return err
		}
		var current providerSnapshot
		if err := json.Unmarshal(payload, &current); err != nil || current.Entries == nil {
			return fmt.Errorf("invalid Paseo provider snapshot")
		}
		last = current
		loading := false
		for _, entry := range current.Entries {
			loading = loading || entry.Status == "loading"
		}
		if !loading {
			return printSnapshot(os.Stdout, current)
		}
		select {
		case <-ctx.Done():
			return printSnapshot(os.Stdout, current)
		case <-tick.C:
		}
	}
}

func printSnapshot(out io.Writer, snapshot providerSnapshot) error {
	for _, provider := range snapshot.Entries {
		fmt.Fprintf(out, "%s: %s\n", provider.Provider, provider.Status)
		for _, model := range provider.Models {
			marker := ""
			if model.IsDefault {
				marker = " [default]"
			}
			fmt.Fprintf(out, "  %s%s\n", model.ID, marker)
		}
	}
	return nil
}
