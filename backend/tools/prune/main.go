package main

import (
	"context"
	"flag"
	"fmt"
	"io"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/pollux-o4/AIN/backend/internal/paseowire"
)

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	if err := run(ctx, os.Args[1:], os.Getenv("PASEO_HOME"), os.Stdout, os.Stderr); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func run(ctx context.Context, args []string, paseoHome string, out, stderr io.Writer) error {
	flags := flag.NewFlagSet("prune", flag.ContinueOnError)
	flags.SetOutput(stderr)
	data := flags.String("data", "", "Go editorial data directory")
	home := flags.String("paseo-home", paseoHome, "local Paseo home (defaults to PASEO_HOME)")
	all := flags.Bool("all", false, "include warm sessions that have no active or unconfirmed work")
	if err := flags.Parse(args); err != nil {
		if err == flag.ErrHelp {
			return nil
		}
		return err
	}
	if *data == "" || *home == "" || flags.NArg() != 0 {
		return fmt.Errorf("--data and --paseo-home (or PASEO_HOME) are required")
	}
	bounded, cancel := context.WithTimeout(ctx, time.Minute)
	defer cancel()
	result, err := prune(bounded, *data, paseowire.New(*home), *all)
	if err != nil {
		return fmt.Errorf("prune ended after archiving %d session(s): %w", result.Archived, err)
	}
	_, err = fmt.Fprintf(out, "archived=%d warm=%d deferred=%d foreign=%d\n", result.Archived, result.Warm, result.Deferred, result.Foreign)
	return err
}
