package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"net/url"
	"os"
	"path/filepath"

	_ "modernc.org/sqlite"
)

func main() {
	if err := run(context.Background(), os.Args[1:]); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func run(ctx context.Context, args []string) error {
	flags := flag.NewFlagSet("labfixture", flag.ContinueOnError)
	source := flags.String("source", "", "source data directory")
	data := flags.String("data", "", "isolated lab data directory")
	from := flags.String("from", "", "unique article ID prefix")
	stage := flags.String("stage", "", "seed stage: plan, compose or figure")
	count := flags.Int("count", 1, "number of isolated copies")
	var lab provenance
	flags.StringVar(&lab.Variant, "variant", "", "applied lab variant")
	flags.StringVar(&lab.Provider, "provider", "", "Paseo provider used by the lab")
	flags.StringVar(&lab.Model, "model", "", "Paseo model used by the lab")
	flags.StringVar(&lab.Thinking, "thinking", "", "Paseo thinking option used by the lab")
	if len(args) == 0 || (args[0] != "seed" && args[0] != "report") {
		return errors.New("expected seed or report")
	}
	if err := flags.Parse(args[1:]); err != nil {
		return err
	}
	if *source == "" || *from == "" || flags.NArg() != 0 {
		return errors.New("--source and --from are required")
	}
	if args[0] == "seed" && os.Getenv("AIN_LIVE") != "1" {
		return errors.New("the figure lab requires explicit AIN_LIVE=1 consent")
	}
	db, err := openReadOnly(*source)
	if err != nil {
		return err
	}
	defer db.Close()
	view, err := db.BeginTx(ctx, &sql.TxOptions{ReadOnly: true})
	if err != nil {
		return err
	}
	defer view.Rollback()
	id, record, err := readRun(ctx, view, *from)
	if err != nil {
		return err
	}
	encoder := json.NewEncoder(os.Stdout)
	if args[0] == "report" {
		report, err := makeReport(ctx, view, id, record)
		if err != nil {
			return err
		}
		return encoder.Encode(report)
	}
	copies, err := seed(ctx, *source, *data, *stage, *count, record, lab)
	if err != nil {
		return err
	}
	return encoder.Encode(copies)
}

func openReadOnly(root string) (*sql.DB, error) {
	path, err := filepath.Abs(filepath.Join(root, "editorial.sqlite"))
	if err != nil {
		return nil, err
	}
	info, err := os.Lstat(path)
	if err != nil || !info.Mode().IsRegular() {
		return nil, errors.New("source editorial database does not exist or is unsafe")
	}
	dsn := url.URL{Scheme: "file", Path: filepath.ToSlash(path), RawQuery: "mode=ro&_pragma=query_only(1)"}
	return sql.Open("sqlite", dsn.String())
}

type reader interface {
	QueryContext(context.Context, string, ...any) (*sql.Rows, error)
}

func readRun(ctx context.Context, db reader, prefix string) (string, json.RawMessage, error) {
	rows, err := db.QueryContext(ctx, "SELECT id, value FROM editorial_runs WHERE substr(id,1,length(?)) = ? LIMIT 2", prefix, prefix)
	if err != nil {
		return "", nil, err
	}
	defer rows.Close()
	var id string
	var data json.RawMessage
	matches := 0
	for rows.Next() {
		var value string
		if err := rows.Scan(&id, &value); err != nil {
			return "", nil, err
		}
		data = json.RawMessage(value)
		matches++
	}
	if err := rows.Err(); err != nil {
		return "", nil, err
	}
	if matches != 1 || !json.Valid(data) {
		return "", nil, errors.New("a unique valid source article is required")
	}
	return id, data, nil
}
