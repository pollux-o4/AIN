package main

import (
	"context"
	"encoding/json"
	"errors"
	"io/fs"
	"os"
	"path/filepath"
	"slices"
)

const packageVersion = 1

type packageManifest struct {
	Version   int         `json:"version"`
	Backup    []fileEntry `json:"backup"`
	Candidate []fileEntry `json:"candidate"`
	Runs      []runEntry  `json:"runs"`
	Holds     []hold      `json:"holds"`
	Jobs      int         `json:"jobs"`
}

type writerProbe func(context.Context, string) error

func prepare(ctx context.Context, source, destination string, probe writerProbe) (packageManifest, error) {
	var result packageManifest
	root, err := sourceRoot(source)
	if err != nil {
		return result, err
	}
	destination, err = privateParent(destination)
	if err != nil {
		return result, err
	}
	if within(root, destination) || within(destination, root) {
		return result, errors.New("source and package directories must be disjoint")
	}
	if err := probe(ctx, root); err != nil {
		return result, err
	}
	if _, err := os.Lstat(destination); err == nil {
		saved, err := verify(ctx, destination)
		if err != nil {
			return result, err
		}
		sourceEntries, err := walkTree(ctx, root, sourceTrees, "")
		if err != nil {
			return result, err
		}
		if !slices.Equal(sourceEntries, saved.Backup) {
			return result, errors.New("existing package belongs to different source content")
		}
		if err := probe(ctx, root); err != nil {
			return result, err
		}
		return saved, nil
	} else if !errors.Is(err, fs.ErrNotExist) {
		return result, err
	}

	stage, err := os.MkdirTemp(filepath.Dir(destination), ".ain-migrate-")
	if err != nil {
		return result, err
	}
	defer os.RemoveAll(stage)
	backup, candidate := filepath.Join(stage, "backup"), filepath.Join(stage, "candidate")
	for _, dir := range []string{backup, candidate} {
		if err := os.Mkdir(dir, 0o700); err != nil {
			return result, err
		}
	}
	result.Version = packageVersion
	result.Backup, err = walkTree(ctx, root, sourceTrees, backup)
	if err != nil {
		return result, err
	}
	if _, err := walkTree(ctx, backup, candidateTrees, candidate); err != nil {
		return result, err
	}
	result.Runs, result.Holds, result.Jobs, err = applySchema(ctx, candidate)
	if err != nil {
		return packageManifest{}, err
	}
	result.Candidate, err = walkTree(ctx, candidate, nil, "")
	if err != nil {
		return packageManifest{}, err
	}
	if err := saveManifest(stage, result); err != nil {
		return packageManifest{}, err
	}
	if _, err := verify(ctx, stage); err != nil {
		return packageManifest{}, err
	}
	if err := syncTree(backup, result.Backup); err != nil {
		return packageManifest{}, err
	}
	if err := syncTree(candidate, result.Candidate); err != nil {
		return packageManifest{}, err
	}
	if err := syncDir(stage); err != nil {
		return packageManifest{}, err
	}
	if err := probe(ctx, root); err != nil {
		return packageManifest{}, err
	}
	final, err := walkTree(ctx, root, sourceTrees, "")
	if err != nil {
		return packageManifest{}, err
	}
	if !slices.Equal(result.Backup, final) {
		return packageManifest{}, errors.New("legacy data changed while preparing the package")
	}
	if err := probe(ctx, root); err != nil {
		return packageManifest{}, err
	}
	if err := publish(ctx, stage, destination); err != nil {
		return packageManifest{}, err
	}
	return result, nil
}

func saveManifest(stage string, result packageManifest) error {
	body, err := json.MarshalIndent(result, "", "  ")
	if err != nil {
		return err
	}
	body = append(body, '\n')
	if err := savePrivate(filepath.Join(stage, "manifest.json"), body); err != nil {
		return err
	}
	return savePrivate(filepath.Join(stage, "manifest.sha256"), []byte(digest(body)+"\n"))
}

func savePrivate(path string, body []byte) error {
	file, err := os.OpenFile(path, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o600)
	if err != nil {
		return err
	}
	_, err = file.Write(body)
	return errors.Join(err, file.Sync(), file.Close())
}

func readPrivate(path string) ([]byte, error) {
	info, err := os.Lstat(path)
	if err != nil || !info.Mode().IsRegular() || info.Mode().Perm()&0o077 != 0 {
		return nil, errors.New("manifest file is not private")
	}
	return os.ReadFile(path)
}

func verify(ctx context.Context, path string) (packageManifest, error) {
	var result packageManifest
	rootInfo, err := os.Lstat(path)
	if err != nil {
		return result, err
	}
	if !rootInfo.IsDir() || rootInfo.Mode().Perm()&0o077 != 0 {
		return result, errors.New("migration package must be a private directory")
	}
	children, err := os.ReadDir(path)
	if err != nil {
		return result, err
	}
	if len(children) != 4 || children[0].Name() != "backup" || !children[0].IsDir() ||
		children[1].Name() != "candidate" || !children[1].IsDir() ||
		children[2].Name() != "manifest.json" || children[3].Name() != "manifest.sha256" {
		return result, errors.New("migration package layout is invalid")
	}
	raw, err := readPrivate(filepath.Join(path, "manifest.json"))
	if err != nil {
		return result, err
	}
	sum, err := readPrivate(filepath.Join(path, "manifest.sha256"))
	if err != nil {
		return result, err
	}
	if string(sum) != digest(raw)+"\n" {
		return result, errors.New("migration manifest hash differs")
	}
	if err := json.Unmarshal(raw, &result); err != nil || result.Version != packageVersion {
		return packageManifest{}, errors.New("unsupported or invalid migration manifest")
	}
	for _, area := range []struct {
		directory string
		entries   []fileEntry
	}{
		{"backup", result.Backup}, {"candidate", result.Candidate},
	} {
		content := filepath.Join(path, area.directory)
		actual, err := walkTree(ctx, content, nil, "")
		if err != nil {
			return packageManifest{}, err
		}
		if !slices.Equal(actual, area.entries) {
			return packageManifest{}, errors.New("migration content hash or file inventory differs")
		}
		if err := checkPrivateTree(content, actual); err != nil {
			return packageManifest{}, err
		}
	}
	return result, nil
}

func checkPrivateTree(root string, entries []fileEntry) error {
	for _, entry := range append([]fileEntry{{Path: "."}}, entries...) {
		info, err := os.Lstat(filepath.Join(root, entry.Path))
		if err != nil || info.Mode().Perm()&0o077 != 0 {
			return errors.New("migration data is not private")
		}
	}
	return nil
}

func restore(ctx context.Context, path, target string) (packageManifest, error) {
	result, err := verify(ctx, path)
	if err != nil {
		return packageManifest{}, err
	}
	root, err := sourceRoot(path)
	if err != nil {
		return packageManifest{}, err
	}
	target, err = privateParent(target)
	if err != nil {
		return packageManifest{}, err
	}
	if within(root, target) || within(target, root) {
		return packageManifest{}, errors.New("restore target and package directories must be disjoint")
	}
	if info, err := os.Lstat(target); err == nil {
		if !info.IsDir() || info.Mode().Perm()&0o077 != 0 {
			return packageManifest{}, errors.New("restore target already exists")
		}
		current, err := walkTree(ctx, target, nil, "")
		if err != nil || !slices.Equal(current, result.Backup) {
			return packageManifest{}, errors.New("existing restore target differs from the backup")
		}
		if err := checkPrivateTree(target, current); err != nil {
			return packageManifest{}, err
		}
		return result, nil
	} else if !errors.Is(err, fs.ErrNotExist) {
		return packageManifest{}, err
	}
	stage, err := os.MkdirTemp(filepath.Dir(target), ".ain-restore-")
	if err != nil {
		return packageManifest{}, err
	}
	defer os.RemoveAll(stage)
	copied, err := walkTree(ctx, filepath.Join(root, "backup"), nil, stage)
	if err != nil {
		return packageManifest{}, err
	}
	if !slices.Equal(copied, result.Backup) {
		return packageManifest{}, errors.New("restore copy does not match verified backup")
	}
	if err := syncTree(stage, copied); err != nil {
		return packageManifest{}, err
	}
	if err := publish(ctx, stage, target); err != nil {
		return packageManifest{}, err
	}
	return result, nil
}
