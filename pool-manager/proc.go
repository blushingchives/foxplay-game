package main

// Host-side resource sampling of a firecracker process via /proc. Everything
// here is best effort: any failure returns zero values, because metrics must
// never break an invocation. Only produces real data on Linux.

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
	// The comm field is "(firecracker)" and may itself contain spaces or
	// parens; everything after the LAST ')' is safely space-separated.
	s := string(data)
	i := strings.LastIndexByte(s, ')')
	if i < 0 {
		return 0, false
	}
	fields := strings.Fields(s[i+1:])
	// fields[0] is state (field 3 of the full line), so utime/stime
	// (fields 14/15) are at indexes 11/12 here.
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

// cpuTicksToMs converts a tick delta to milliseconds. USER_HZ is 100 on
// Linux x86, so granularity is 10ms — short invocations often report 0 and
// values are quantized to multiples of 10.
func cpuTicksToMs(ticks uint64) int64 {
	return int64(ticks) * 1000 / 100
}

// readPeakRSSKB returns the process's peak resident set size (VmHWM) in KB
// from /proc/<pid>/status. VmHWM is monotonic over the process lifetime, so
// for a reused warm VM it covers all invocations so far — which is the right
// answer to "how much memory does this function need".
func readPeakRSSKB(pid int) int64 {
	data, err := os.ReadFile(fmt.Sprintf("/proc/%d/status", pid))
	if err != nil {
		return 0
	}
	for _, line := range strings.Split(string(data), "\n") {
		if strings.HasPrefix(line, "VmHWM:") {
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
