package runtime

import (
	"go/ast"
	"go/parser"
	"go/token"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
)

func TestARCH001CorePackageBoundaries(t *testing.T) {
	const internal = "github.com/pollux-o4/AIN/backend/internal/"
	rules := map[string]map[string]bool{
		"contract":     {},
		"writing":      {"contract": true},
		"figuredomain": {"contract": true, "writing": true},
		"paseowire":    {"contract": true},
	}
	for name, allowed := range rules {
		t.Run(name, func(t *testing.T) {
			dir := filepath.Join("..", name)
			packages, err := parser.ParseDir(token.NewFileSet(), dir, func(info os.FileInfo) bool {
				return !strings.HasSuffix(info.Name(), "_test.go")
			}, parser.ImportsOnly)
			if err != nil {
				t.Fatal(err)
			}
			pkg := packages[name]
			if pkg == nil {
				t.Fatalf("missing package %s", name)
			}
			for file, source := range pkg.Files {
				checkCoreImports(t, source, file, internal, allowed)
			}
		})
	}
}

func checkCoreImports(t *testing.T, source *ast.File, file, internal string, allowed map[string]bool) {
	t.Helper()
	for _, spec := range source.Imports {
		path, err := strconv.Unquote(spec.Path.Value)
		if err != nil {
			t.Fatal(err)
		}
		if target, local := strings.CutPrefix(path, internal); local && !allowed[target] {
			t.Errorf("%s imports %s across the package boundary", file, path)
		}
	}
}
