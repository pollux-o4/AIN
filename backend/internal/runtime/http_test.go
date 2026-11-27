package runtime

import (
	"net/http"
	"strings"
	"testing"
)

func TestAINAPI001RejectsNonLoopback(t *testing.T) {
	for _, address := range []string{":0", "0.0.0.0:0", "[::]:0", "localhost:0"} {
		t.Run(address, func(t *testing.T) {
			err := Serve(t.Context(), address, http.NotFoundHandler())
			if err == nil || !strings.Contains(err.Error(), "requires an IPv4 loopback") {
				t.Fatalf("unexpected bind result: %v", err)
			}
		})
	}
}
