package runtime

import (
	"context"
	"net"
	"net/http"
	"strings"
	"testing"
	"time"
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

func TestAINAPI001ShutdownCancelsRequests(t *testing.T) {
	ctx, cancel := context.WithCancel(t.Context())
	defer cancel()
	listener, err := net.Listen("tcp4", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	entered := make(chan struct{})
	stopped := make(chan struct{})
	serverDone := make(chan error, 1)
	go func() {
		serverDone <- serveListener(ctx, listener, http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			close(entered)
			<-r.Context().Done()
			close(stopped)
			w.WriteHeader(http.StatusNoContent)
		}))
	}()

	requestCtx, endRequest := context.WithTimeout(t.Context(), 5*time.Second)
	defer endRequest()
	request, err := http.NewRequestWithContext(requestCtx, http.MethodGet, "http://"+listener.Addr().String(), nil)
	if err != nil {
		t.Fatal(err)
	}
	responseDone := make(chan error, 1)
	go func() {
		response, err := http.DefaultClient.Do(request)
		if err == nil {
			err = response.Body.Close()
		}
		responseDone <- err
	}()
	select {
	case <-entered:
	case <-requestCtx.Done():
		t.Fatal("request never reached handler")
	}
	cancel()
	select {
	case err := <-serverDone:
		if err != nil {
			t.Fatal(err)
		}
	case <-requestCtx.Done():
		t.Fatal("server did not drain")
	}
	select {
	case <-stopped:
	default:
		t.Fatal("request context was not canceled")
	}
	if err := <-responseDone; err != nil {
		t.Fatal(err)
	}
}
