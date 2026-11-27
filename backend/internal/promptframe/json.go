package promptframe

import (
	"bytes"
	"encoding/json"
)

// Encode marshals like JSON.stringify: compact, key order of raw values kept, HTML characters literal.
func Encode(value any) json.RawMessage {
	var out bytes.Buffer
	enc := json.NewEncoder(&out)
	enc.SetEscapeHTML(false)
	if err := enc.Encode(value); err != nil {
		panic(err) // Callers provide JSON values or fixed Go scalar types.
	}
	return nativeJSON(bytes.TrimSuffix(out.Bytes(), []byte("\n")))
}

// encoding/json quotes HTML characters and line separators in existing raw
// state. JS leaves these characters and a forward slash literal.
func nativeJSON(raw []byte) []byte {
	first := bytes.IndexByte(raw, '\\')
	if first < 0 {
		return raw
	}
	result := append([]byte{}, raw[:first]...)
	for i := first; i < len(raw); i++ {
		if raw[i] != '\\' || i+1 == len(raw) {
			result = append(result, raw[i])
			continue
		}
		if raw[i+1] == '/' {
			result = append(result, '/')
			i++
			continue
		}
		if i+6 <= len(raw) && raw[i+1] == 'u' {
			var replacement string
			switch string(raw[i+2 : i+6]) {
			case "003c", "003C":
				replacement = "<"
			case "003e", "003E":
				replacement = ">"
			case "0026":
				replacement = "&"
			case "2028":
				replacement = "\u2028"
			case "2029":
				replacement = "\u2029"
			}
			if replacement != "" {
				result = append(result, replacement...)
				i += 5
				continue
			}
		}
		result = append(result, raw[i:i+2]...)
		i++
	}
	return result
}
