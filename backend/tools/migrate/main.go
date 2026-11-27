// Command migrate prepares and restores an offline AIN migration package.
package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"io"
	"os"
	"os/signal"
	"syscall"
)

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	if err := run(ctx, os.Args[1:], os.Stdout); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func run(ctx context.Context, args []string, stdout io.Writer) error {
	if len(args) == 0 {
		return errors.New("usage: migrate prepare|verify|restore [flags]")
	}
	flags := flag.NewFlagSet(args[0], flag.ContinueOnError)
	flags.SetOutput(io.Discard)
	pkg := flags.String("package", "", "migration package")
	var source, target *string
	var confirmation *bool
	switch args[0] {
	case "prepare":
		source = flags.String("source", "", "private legacy data root")
		confirmation = flags.Bool("offline", false, "writers are stopped and prevented from restarting")
	case "restore":
		target = flags.String("target", "", "private destination root")
		confirmation = flags.Bool("before-go-writes", false, "no Go runtime writes need to be preserved")
	case "verify":
	default:
		return errors.New("usage: migrate prepare|verify|restore [flags]")
	}
	if err := flags.Parse(args[1:]); err != nil {
		return err
	}
	if flags.NArg() != 0 || *pkg == "" {
		return errors.New("migration package is required")
	}
	var result packageManifest
	var err error
	switch args[0] {
	case "prepare":
		if *source == "" || !*confirmation {
			return errors.New("prepare requires --source and --offline")
		}
		result, err = prepare(ctx, *source, *pkg, findWriter)
	case "verify":
		result, err = verify(ctx, *pkg)
	case "restore":
		if *target == "" || !*confirmation {
			return errors.New("restore requires --target and --before-go-writes")
		}
		result, err = restore(ctx, *pkg, *target)
	}
	if err != nil {
		return err
	}
	_, err = fmt.Fprintf(stdout, "%s verified: %d runs, %d legacy jobs, %d held for reconciliation\n",
		args[0], len(result.Runs), result.Jobs, len(result.Holds))
	return err
}
