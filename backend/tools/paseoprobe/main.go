// Command paseoprobe verifies Paseo MIG-002 loopback admission and read-only lookup.
package main

import (
	"context"
	"flag"
	"fmt"
	"os"
	"time"
)

func main() {
	home := flag.String("home", os.Getenv("PASEO_HOME"), "Paseo launcher home")
	flag.Parse()
	if *home == "" {
		fmt.Fprintln(os.Stderr, "Specify -home or set PASEO_HOME")
		os.Exit(2)
	}
	target, err := loadLocalTarget(*home)
	if err == nil {
		ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
		err = probe(ctx, target)
		cancel()
	}
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	fmt.Println("Paseo hello and read-only lookup succeeded")
}
