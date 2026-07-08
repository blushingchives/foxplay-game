package main

import (
	"archive/tar"
	"compress/gzip"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

type ArtifactStore struct {
	functionsDir   string
	kernelPath     string
	baseRootfs     string
	firecrackerBin string
}

func (s *ArtifactStore) handleDeploy(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}

	functionName := strings.TrimPrefix(r.URL.Path, "/deploy/")
	if functionName == "" {
		http.Error(w, "function name required", http.StatusBadRequest)
		return
	}

	if !isValidName(functionName) {
		http.Error(w, "invalid function name: use lowercase letters, digits, and hyphens only", http.StatusBadRequest)
		return
	}

	if err := r.ParseMultipartForm(256 << 20); err != nil {
		http.Error(w, "parse form: "+err.Error(), http.StatusBadRequest)
		return
	}

	file, _, err := r.FormFile("code")
	if err != nil {
		http.Error(w, "missing 'code' file field (send a .tar.gz)", http.StatusBadRequest)
		return
	}
	defer file.Close()

	if err := s.buildAndStore(functionName, file); err != nil {
		log.Printf("[%s] build failed: %v", functionName, err)
		http.Error(w, "build failed: "+err.Error(), http.StatusInternalServerError)
		return
	}

	// Snapshotting is opt-out: the frontend sends snapshot=false to skip it
	// (the function then cold boots on every start). Best effort either way:
	// without a snapshot the function still works.
	if r.FormValue("snapshot") == "false" {
		os.Remove(filepath.Join(s.functionsDir, functionName+".snap"))
		os.Remove(filepath.Join(s.functionsDir, functionName+".mem"))
		log.Printf("[%s] snapshot disabled by request", functionName)
	} else if err := s.snapshotFunction(functionName); err != nil {
		log.Printf("[%s] snapshot failed: %v (function will cold boot)", functionName, err)
	} else {
		log.Printf("[%s] snapshot ready", functionName)
	}

	log.Printf("[%s] deployed", functionName)
	w.WriteHeader(http.StatusOK)
}

func (s *ArtifactStore) buildAndStore(functionName string, tarball io.Reader) error {
	tmpDir, err := os.MkdirTemp("", "deploy-"+functionName+"-")
	if err != nil {
		return fmt.Errorf("mktemp: %w", err)
	}
	defer os.RemoveAll(tmpDir)

	srcDir := filepath.Join(tmpDir, "src")
	if err := os.Mkdir(srcDir, 0755); err != nil {
		return fmt.Errorf("mkdir src: %w", err)
	}

	if err := extractTar(tarball, srcDir); err != nil {
		return fmt.Errorf("extract tarball: %w", err)
	}

	sizeMB, err := measuredSizeMB(srcDir)
	if err != nil {
		return fmt.Errorf("measure size: %w", err)
	}
	log.Printf("[%s] content size %d MB (with overhead)", functionName, sizeMB)

	imgPath := filepath.Join(tmpDir, functionName+".ext4")
	cmd := exec.Command("mkfs.ext4", "-d", srcDir, imgPath, fmt.Sprintf("%dM", sizeMB))
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	if err := cmd.Run(); err != nil {
		return fmt.Errorf("mkfs.ext4: %w", err)
	}

	dest := filepath.Join(s.functionsDir, functionName+".ext4")
	if err := os.Rename(imgPath, dest); err != nil {
		// os.Rename fails across devices; fall back to copy
		return copyFile(imgPath, dest)
	}

	return nil
}

func extractTar(r io.Reader, destDir string) error {
	gr, err := gzip.NewReader(r)
	if err != nil {
		return fmt.Errorf("not a valid gzip stream: %w", err)
	}
	defer gr.Close()

	tr := tar.NewReader(gr)
	for {
		hdr, err := tr.Next()
		if err == io.EOF {
			break
		}
		if err != nil {
			return err
		}

		// Prevent path traversal attacks
		clean := filepath.Clean(destDir)
		target := filepath.Join(destDir, filepath.Clean("/"+hdr.Name))
		if target != clean && !strings.HasPrefix(target, clean+string(os.PathSeparator)) {
			return fmt.Errorf("illegal path in tarball: %s", hdr.Name)
		}

		switch hdr.Typeflag {
		case tar.TypeDir:
			if err := os.MkdirAll(target, 0755); err != nil {
				return err
			}
		case tar.TypeReg:
			if err := os.MkdirAll(filepath.Dir(target), 0755); err != nil {
				return err
			}
			f, err := os.OpenFile(target, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, os.FileMode(hdr.Mode))
			if err != nil {
				return err
			}
			_, copyErr := io.Copy(f, tr)
			f.Close()
			if copyErr != nil {
				return copyErr
			}
		}
	}
	return nil
}

func copyFile(src, dst string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()

	out, err := os.Create(dst)
	if err != nil {
		return err
	}
	defer out.Close()

	_, err = io.Copy(out, in)
	return err
}

// measuredSizeMB walks dir and estimates the ext4 image size needed to hold
// it. Every file occupies whole 4KB blocks, each entry costs roughly a block
// of inode/directory metadata, and small images still need ~4MB for the
// journal plus group tables — so we round per file, add per-entry overhead,
// 20% slack, and a fixed 8MB floor on top.
func measuredSizeMB(dir string) (int, error) {
	const blockSize = 4096
	var total int64
	var entries int64
	err := filepath.Walk(dir, func(_ string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		entries++
		if !info.IsDir() {
			total += (info.Size() + blockSize - 1) / blockSize * blockSize
		}
		return nil
	})
	if err != nil {
		return 0, err
	}
	total += entries * blockSize
	withOverhead := int64(float64(total) * 1.2)
	mb := (withOverhead + (1<<20 - 1)) >> 20 // round up to nearest MB
	mb += 8                                  // journal + group tables
	if mb < 16 {
		mb = 16
	}
	return int(mb), nil
}

func isValidName(s string) bool {
	if len(s) == 0 || len(s) > 64 {
		return false
	}
	for _, c := range s {
		if !((c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') || c == '-') {
			return false
		}
	}
	return true
}
