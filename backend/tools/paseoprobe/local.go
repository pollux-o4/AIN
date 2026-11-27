package main

import (
	"encoding/json"
	"errors"
	"net"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
)

type localTarget struct {
	address    string
	credential string
}

var localCredentialPattern = regexp.MustCompile(`^[A-Za-z0-9_-]{43}$`)

func loadLocalTarget(home string) (localTarget, error) {
	var config struct {
		Daemon struct {
			Listen string `json:"listen"`
		} `json:"daemon"`
	}
	data, err := os.ReadFile(filepath.Join(home, "config.json"))
	if err != nil || json.Unmarshal(data, &config) != nil {
		return localTarget{}, errors.New("cannot read Paseo config.json")
	}
	address, err := loopbackAddress(config.Daemon.Listen)
	if err != nil {
		return localTarget{}, err
	}

	var lock struct {
		Listen string `json:"listen"`
	}
	data, err = os.ReadFile(filepath.Join(home, "paseo.pid"))
	if err != nil || json.Unmarshal(data, &lock) != nil {
		return localTarget{}, errors.New("cannot read Paseo paseo.pid")
	}
	listening, err := loopbackAddress(strings.TrimPrefix(strings.TrimSpace(lock.Listen), "tcp://"))
	if err != nil || comparableAddress(address) != comparableAddress(listening) {
		return localTarget{}, errors.New("Paseo credential target does not match the daemon lock")
	}

	data, err = os.ReadFile(filepath.Join(home, "local-credential"))
	credential := strings.TrimSpace(string(data))
	if err != nil || !localCredentialPattern.MatchString(credential) {
		return localTarget{}, errors.New("Paseo local credential is unavailable or malformed")
	}
	return localTarget{address: address, credential: credential}, nil
}

func loopbackAddress(address string) (string, error) {
	address = strings.TrimSpace(address)
	host, port, err := net.SplitHostPort(address)
	if err != nil {
		// A bare port is interpreted as localhost in Paseo daemon locks.
		host, port = "localhost", address
	}
	portNumber, err := strconv.ParseUint(port, 10, 16)
	if err != nil || portNumber == 0 {
		return "", errors.New("Paseo probe requires a loopback TCP listener")
	}
	switch host {
	case "0.0.0.0":
		host = "127.0.0.1"
	case "::":
		host = "::1"
	case "localhost":
	default:
		if ip := net.ParseIP(host); ip == nil || !ip.IsLoopback() {
			return "", errors.New("Paseo probe requires a loopback TCP listener")
		}
	}
	return net.JoinHostPort(host, strconv.FormatUint(portNumber, 10)), nil
}

func comparableAddress(address string) string {
	host, port, _ := net.SplitHostPort(address)
	switch host {
	case "127.0.0.1", "::1":
		return net.JoinHostPort("localhost", port)
	default:
		return address
	}
}
