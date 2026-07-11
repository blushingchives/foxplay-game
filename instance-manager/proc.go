package main

// Host-side resource sampling of a firecracker process via /proc. Best
// effort: any failure returns zeros so sampling never disrupts an instance.
// Linux-only in effect (returns zeros elsewhere).

import (
	"fmt"
	"os"
	"strconv"
	"strings"
)

// readCPUTicks returns utime+stime clock ticks for pid from /proc/<pid>/stat.
func readCPUTicks(pid int) (uint64, bool) {
	data, err := os.ReadFile(fmt.Sprintf("/proc/%d/stat", pid))
	if err != nil {
		return 0, false
	}
	// comm field may contain spaces/parens; fields after the last ')' are
	// safely space-separated. utime/stime are fields 14/15 → indexes 11/12.
	s := string(data)
	i := strings.LastIndexByte(s, ')')
	if i < 0 {
		return 0, false
	}
	fields := strings.Fields(s[i+1:])
	if len(fields) < 13 {
		return 0, false
	}
	utime, err1 := strconv.ParseUint(fields[11], 10, 64)
	stime, err2 := strconv.ParseUint(fields[12], 10, 64)
	if err1 != nil || err2 != nil {
		return 0, false
	}
	return utime + stime, true
}

// readRSSKB returns the process's current resident set size (VmRSS) in KB
// from /proc/<pid>/status.
func readRSSKB(pid int) int64 {
	data, err := os.ReadFile(fmt.Sprintf("/proc/%d/status", pid))
	if err != nil {
		return 0
	}
	for _, line := range strings.Split(string(data), "\n") {
		if strings.HasPrefix(line, "VmRSS:") {
			fields := strings.Fields(line)
			if len(fields) >= 2 {
				if v, err := strconv.ParseInt(fields[1], 10, 64); err == nil {
					return v
				}
			}
			return 0
		}
	}
	return 0
}
