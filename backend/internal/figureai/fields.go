package figureai

import (
	"bytes"
	"encoding/json"

	"github.com/pollux-o4/AIN/backend/internal/promptframe"
)

// fieldList keeps prompt data in the Node reference key order.
type fieldList []struct {
	key string
	raw json.RawMessage
}

// add skips values JavaScript treats as absent in a conditional spread: null, false, "" and 0.
func (list *fieldList) add(key string, raw json.RawMessage) {
	switch string(bytes.TrimSpace(raw)) {
	case "", "null", "false", `""`, "0":
		return
	}
	*list = append(*list, struct {
		key string
		raw json.RawMessage
	}{key, raw})
}

func (list fieldList) raw() []byte {
	out := []byte{'{'}
	for i, field := range list {
		if i > 0 {
			out = append(out, ',')
		}
		out = append(out, promptframe.Encode(field.key)...)
		out = append(out, ':')
		out = append(out, promptframe.Encode(field.raw)...)
	}
	return append(out, '}')
}
