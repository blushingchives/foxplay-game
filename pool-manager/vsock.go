package main

import (
	"bufio"
	"encoding/json"
	"fmt"
	"net"
	"strings"
	"time"
)

const bootstrapPort = 8080

// InvocationEvent is the HTTP request forwarded to the VM.
type InvocationEvent struct {
	Method  string              `json:"method"`
	Path    string              `json:"path"`
	Query   string              `json:"query"`
	Headers map[string][]string `json:"headers"`
	Body    string              `json:"body"`
}

// InvocationResponse is the HTTP response returned from the VM.
type InvocationResponse struct {
	Status  int                 `json:"status"`
	Headers map[string][]string `json:"headers"`
	Body    string              `json:"body"`
}

// connectVsock opens a connection to the bootstrap inside a Firecracker VM.
// Firecracker exposes vsock as a Unix socket using the proxy protocol:
//   host → guest: connect to UDS, send "CONNECT <port>\n", read "OK <port>\n"
func connectVsock(vsockPath string) (net.Conn, error) {
	conn, err := net.Dial("unix", vsockPath)
	if err != nil {
		return nil, err
	}

	fmt.Fprintf(conn, "CONNECT %d\n", bootstrapPort)

	reader := bufio.NewReader(conn)
	line, err := reader.ReadString('\n')
	if err != nil {
		conn.Close()
		return nil, fmt.Errorf("vsock handshake read: %w", err)
	}
	if !strings.HasPrefix(line, "OK") {
		conn.Close()
		return nil, fmt.Errorf("vsock handshake failed: %q", line)
	}

	return conn, nil
}

// waitForVsock polls until the bootstrap is listening on vsock or timeout.
func waitForVsock(vsockPath string, timeout time.Duration) error {
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		conn, err := connectVsock(vsockPath)
		if err == nil {
			conn.Close()
			return nil
		}
		time.Sleep(100 * time.Millisecond)
	}
	return fmt.Errorf("timeout waiting for bootstrap on %s", vsockPath)
}

// invokeViaVsock sends an invocation to the VM and returns the response.
func invokeViaVsock(vsockPath string, event InvocationEvent) (*InvocationResponse, error) {
	conn, err := connectVsock(vsockPath)
	if err != nil {
		return nil, fmt.Errorf("connect vsock: %w", err)
	}
	defer conn.Close()

	conn.SetDeadline(time.Now().Add(30 * time.Second))

	if err := json.NewEncoder(conn).Encode(event); err != nil {
		return nil, fmt.Errorf("send event: %w", err)
	}

	var resp InvocationResponse
	if err := json.NewDecoder(conn).Decode(&resp); err != nil {
		return nil, fmt.Errorf("read response: %w", err)
	}

	return &resp, nil
}
