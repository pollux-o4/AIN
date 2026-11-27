package figureai

import (
	"bytes"
	"crypto/sha256"
	"encoding/binary"
	"errors"
	"image/png"
	"regexp"
	"slices"
	"unicode/utf8"

	"github.com/pollux-o4/AIN/backend/internal/figuredomain"
	"golang.org/x/image/webp"
)

var ErrRouteUnavailable = errors.New("the figure render route is unavailable")

// EffectiveRoute resolves the person's choice before the visual kind default.
func EffectiveRoute(kind, override string) string {
	if override != "" {
		return override
	}
	if kind == "scene" {
		return "image"
	}
	return "svg"
}

type RouteFile struct {
	Path  string `json:"path"`
	MIME  string `json:"mime"`
	Bytes int    `json:"bytes"`
}

var routeFilename = regexp.MustCompile(`^[a-zA-Z0-9_.-]+$`)

const rasterBytes = 4000000
const rasterPixels = 16000000

func knownRoute(route string) bool { return route == "svg" || route == "image" }

// ValidateRouteFiles validates output in the named workspace. This is the
// renderer boundary for raster artifacts as well as SVG. Raster results need
// a separate domain storage contract before they can complete an editorial turn.
func ValidateRouteFiles(workRoot, workID, route string, files []RouteFile) ([]RouteFile, error) {
	if !knownRoute(route) {
		return nil, ErrRouteUnavailable
	}
	room, err := openWorkspace(workRoot, workID, false)
	if err != nil {
		return nil, err
	}
	defer room.close()
	validated, _, err := validateRouteFiles(room, route, files)
	return validated, err
}

func validateRouteFiles(room *workspace, route string, files []RouteFile) ([]RouteFile, [][sha256.Size]byte, error) {
	if len(files) == 0 || len(files) > 3 {
		return nil, nil, errors.New("invalid figure route file count")
	}
	digests := make([][sha256.Size]byte, 0, len(files))
	result := make([]RouteFile, 0, len(files))
	seen := map[string]bool{}
	for _, file := range files {
		if !routeFilename.MatchString(file.Path) || slices.Contains([]string{".", ".."}, file.Path) || seen[file.Path] {
			return nil, nil, errors.New("figure route file name is invalid")
		}
		seen[file.Path] = true
		limit := int64(rasterBytes)
		switch {
		case route == "svg" && file.MIME == "image/svg+xml":
			limit = svgLimit
		case route == "image" && (file.MIME == "image/png" || file.MIME == "image/webp"):
		default:
			return nil, nil, errors.New("figure route file MIME is unsupported")
		}
		data, err := readRegular(room.root, file.Path, limit)
		if err != nil {
			return nil, nil, err
		}
		if err := validateMIME(file.MIME, data); err != nil {
			return nil, nil, err
		}
		file.Bytes = len(data)
		result = append(result, file)
		digests = append(digests, sha256.Sum256(data))
	}
	return result, digests, nil
}

func validateMIME(mime string, data []byte) error {
	switch mime {
	case "image/svg+xml":
		if utf8.Valid(data) {
			_, err := figuredomain.NormalizeSVG(string(data))
			return err
		}
	case "image/png":
		config, err := png.DecodeConfig(bytes.NewReader(data))
		if err == nil && config.Width > 0 && config.Height > 0 && config.Width <= rasterPixels/config.Height {
			if _, err := png.Decode(bytes.NewReader(data)); err == nil {
				return nil
			}
		}
	case "image/webp":
		if validWebP(data) {
			config, err := webp.DecodeConfig(bytes.NewReader(data))
			if err == nil && rasterSize(config.Width, config.Height) {
				if decoded, err := webp.Decode(bytes.NewReader(data)); err == nil &&
					decoded.Bounds().Dx() == config.Width && decoded.Bounds().Dy() == config.Height {
					return nil
				}
			}
		}
	}
	return errors.New("figure route file is malformed or exceeds its dimensions")
}

func validWebP(data []byte) bool {
	if len(data) < 20 || string(data[:4]) != "RIFF" || string(data[8:12]) != "WEBP" ||
		uint64(binary.LittleEndian.Uint32(data[4:8]))+8 != uint64(len(data)) {
		return false
	}
	foundImage := false
	offset := 12
	for offset+8 <= len(data) {
		kind := string(data[offset : offset+4])
		size := int(binary.LittleEndian.Uint32(data[offset+4 : offset+8]))
		start := offset + 8
		if size > len(data)-start {
			return false
		}
		chunk := data[start : start+size]
		switch kind {
		case "ANIM", "ANMF":
			return false
		case "VP8X":
			if len(chunk) != 10 || chunk[0]&2 != 0 || !rasterSize(1+uint24(chunk[4:7]), 1+uint24(chunk[7:10])) {
				return false
			}
		case "VP8 ":
			if foundImage || len(chunk) < 11 || chunk[0]&1 != 0 || !bytes.Equal(chunk[3:6], []byte{0x9d, 0x01, 0x2a}) ||
				!rasterSize(int(binary.LittleEndian.Uint16(chunk[6:8])&0x3fff), int(binary.LittleEndian.Uint16(chunk[8:10])&0x3fff)) {
				return false
			}
			foundImage = true
		case "VP8L":
			if foundImage || len(chunk) < 6 || chunk[0] != 0x2f {
				return false
			}
			dimensions := binary.LittleEndian.Uint32(chunk[1:5])
			if dimensions>>29 != 0 || !rasterSize(1+int(dimensions&0x3fff), 1+int((dimensions>>14)&0x3fff)) {
				return false
			}
			foundImage = true
		}
		offset = start + size + size%2
	}
	return foundImage && offset == len(data)
}

func uint24(data []byte) int {
	return int(data[0]) | int(data[1])<<8 | int(data[2])<<16
}

func rasterSize(width, height int) bool {
	return width > 0 && height > 0 && width <= rasterPixels/height
}
