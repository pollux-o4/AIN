package runtime

import (
	"context"
	"errors"
	"net"
	"net/http"
	"time"
)

// Serve binds the editor to IPv4 loopback and drains requests on cancellation.
// The context also stops long-lived activity streams before the drain begins.
func Serve(ctx context.Context, address string, handler http.Handler) error {
	host, _, err := net.SplitHostPort(address)
	if err != nil || host != "127.0.0.1" {
		return errors.New("editorial HTTP requires an IPv4 loopback address")
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	listener, err := net.Listen("tcp4", address)
	if err != nil {
		return err
	}
	return serveListener(ctx, listener, handler)
}

func serveListener(ctx context.Context, listener net.Listener, handler http.Handler) error {
	server := &http.Server{
		Handler:           handler,
		ReadHeaderTimeout: 5 * time.Second,
		IdleTimeout:       60 * time.Second,
		BaseContext:       func(net.Listener) context.Context { return ctx },
	}
	done := make(chan error, 1)
	go func() { done <- server.Serve(listener) }()

	select {
	case err := <-done:
		return err
	case <-ctx.Done():
	}
	shutdown, cancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
	defer cancel()
	drainErr := server.Shutdown(shutdown)
	if drainErr != nil {
		drainErr = errors.Join(drainErr, server.Close())
	}
	if serveErr := <-done; !errors.Is(serveErr, http.ErrServerClosed) {
		return errors.Join(drainErr, serveErr)
	}
	return drainErr
}
