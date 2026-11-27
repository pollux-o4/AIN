package artifacts

import (
	"archive/zip"
	"bytes"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"hash/crc32"
	"net/http"
	"strings"
)

const documentCSS = `:root{color-scheme:light dark;--fg:#1d1d1f;--muted:#6e6e73;--bg:#fff;--line:#e5e5ea}
@media (prefers-color-scheme:dark){:root{--fg:#f5f5f7;--muted:#a1a1a6;--bg:#111;--line:#2c2c2e}}
body{margin:0;background:var(--bg);color:var(--fg);font:17px/1.75 system-ui,-apple-system,"Apple SD Gothic Neo","Noto Sans KR",sans-serif;word-break:keep-all}
article{max-width:42rem;margin:0 auto;padding:3rem 1rem 5rem}
h1{font-size:2rem;line-height:1.3}h2{margin-top:2.5em}pre{overflow-x:auto;padding:1rem;border:1px solid var(--line);border-radius:8px}
code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.9em}
table{border-collapse:collapse;width:100%}th,td{border:1px solid var(--line);padding:.4rem .6rem}
figure{margin:2rem 0}figure img{display:block;width:100%;height:auto}figcaption{margin-top:.5rem;color:var(--muted);font-size:.9rem;text-align:center}`

const documentTemplate = `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="AIN">
<title>%s</title>
<style>%s</style>
</head>
<body>
<article>
<h1>%s</h1>
%s
</article>
</body>
</html>
`

type article struct {
	id, title string
	revision  int
	text      string
	figures   []figure
	approval  *bundleApproval
}

type bundleApproval struct {
	Revision   int    `json:"revision"`
	ApprovedAt *int64 `json:"approvedAt"`
}

type bundleFigure struct {
	ID         string  `json:"id"`
	Anchor     string  `json:"anchor"`
	Alt        string  `json:"alt"`
	Caption    *string `json:"caption"`
	Animated   bool    `json:"animated"`
	File       string  `json:"file"`
	StaticFile string  `json:"staticFile"`
}
type bundleArticle struct {
	ID       string `json:"id"`
	Title    string `json:"title"`
	Revision int    `json:"revision"`
}
type bundleEntry struct {
	Markdown string `json:"markdown"`
	HTML     string `json:"html"`
	Fragment string `json:"fragment"`
}
type manifest struct {
	Format   string          `json:"format"`
	Version  int             `json:"version"`
	Article  bundleArticle   `json:"article"`
	Approval *bundleApproval `json:"approval,omitempty"`
	Motion   string          `json:"motion"`
	Entry    bundleEntry     `json:"entry"`
	Figures  []bundleFigure  `json:"figures"`
}

func toTXT(text string) string {
	if strings.HasSuffix(text, "\n") {
		return text
	}
	return text + "\n"
}

func htmlDocument(title, body string) string {
	title = escape(title)
	return fmt.Sprintf(documentTemplate, title, documentCSS, title, body)
}

func figurePath(id, motion string) string {
	if motion == "static" {
		return "figures/" + id + ".static.svg"
	}
	return "figures/" + id + ".svg"
}

func exportFigure(item figure, src string) string {
	figureHTML := fmt.Sprintf(`<figure data-figure="%s"><img src="%s" alt="%s" loading="lazy" decoding="async">`, item.ID, escape(src), escape(item.Alt))
	if item.Caption != nil && *item.Caption != "" {
		figureHTML += "<figcaption>" + escape(*item.Caption) + "</figcaption>"
	}
	return figureHTML + "</figure>"
}

var stripBrackets = strings.NewReplacer("[", "", "]", "")

func markdownWith(text string, figures []spot, motion string) (string, error) {
	var output strings.Builder
	err := interleave(text, figures, func(part string) error {
		output.WriteString(part)
		return nil
	}, func(spot spot) {
		item := spot.figure
		fmt.Fprintf(&output, "\n\n![%s](%s)", stripBrackets.Replace(item.Alt), figurePath(item.ID, motion))
		if item.Caption != nil && *item.Caption != "" {
			fmt.Fprintf(&output, "\n\n*%s*", *item.Caption)
		}
	})
	return output.String(), err
}

func exportArticle(a article, options Options) (File, error) {
	format, motion := options.Format, options.Motion
	if format == "" {
		format = "txt"
	}
	if motion == "" {
		motion = "animated"
	}
	if (format != "txt" && format != "html" && format != "zip") || (motion != "animated" && motion != "static") {
		return File{}, &Error{http.StatusBadRequest, "내보내기 형식을 확인해 주세요."}
	}
	base := fmt.Sprintf("article-%s-r%d", a.id, a.revision)
	if format == "txt" {
		return File{[]byte(toTXT(a.text)), txtType, base + ".txt"}, nil
	}
	items := make([]spot, 0, len(a.figures))
	documents := make(map[string]svgDocument, len(a.figures))
	for _, item := range a.figures {
		if !figureID.MatchString(item.ID) {
			return File{}, errUnsafeSVG
		}
		if _, exists := documents[item.ID]; exists {
			return File{}, errUnsafeSVG
		}
		document, err := parseSVG(item.SVG)
		if err != nil {
			return File{}, err
		}
		items = append(items, spot{figure: item, drawn: true})
		documents[item.ID] = document
	}
	body, err := renderArticle(a.title, a.text, items, func(spot spot) string {
		item := spot.figure
		src := figurePath(item.ID, motion)
		if format == "html" {
			document := documents[item.ID]
			svg := document.body
			if motion == "static" {
				svg = document.static()
			}
			src = "data:" + svgType + ";base64," + base64.StdEncoding.EncodeToString([]byte(svg))
		}
		return exportFigure(item, src)
	})
	if err != nil {
		return File{}, err
	}
	document := htmlDocument(a.title, body)
	if format == "html" {
		return File{[]byte(document), htmlType, base + ".html"}, nil
	}
	bundle, err := zipBundle(a, items, documents, motion, document, body)
	return File{bundle, "application/zip", base + ".zip"}, err
}

type member struct{ name, data string }

func zipBundle(a article, items []spot, documents map[string]svgDocument, motion, html, body string) ([]byte, error) {
	entry := bundleEntry{"article.md", "article.html", "article-body.html"}
	figures := make([]bundleFigure, 0, len(items))
	md, err := markdownWith(a.text, items, motion)
	if err != nil {
		return nil, err
	}
	files := []member{{entry.Markdown, toTXT(md)}, {entry.HTML, html}, {entry.Fragment, body + "\n"}}
	for _, spot := range items {
		f := spot.figure
		svg := documents[f.ID]
		dynamic, static := figurePath(f.ID, "animated"), figurePath(f.ID, "static")
		figures = append(figures, bundleFigure{f.ID, f.Anchor, f.Alt, f.Caption, svg.animated, dynamic, static})
		files = append(files, member{dynamic, svg.body}, member{static, svg.static()})
	}
	head := manifest{
		Format: "ain-article-bundle", Version: 1, Article: bundleArticle{a.id, a.title, a.revision},
		Approval: a.approval, Motion: motion, Entry: entry, Figures: figures,
	}
	var metadata bytes.Buffer
	enc := json.NewEncoder(&metadata)
	enc.SetIndent("", "  ")
	enc.SetEscapeHTML(false)
	if err := enc.Encode(head); err != nil {
		return nil, err
	}
	return storedZIP(append([]member{{"manifest.json", metadata.String()}}, files...))
}

func storedZIP(files []member) ([]byte, error) {
	var buffer bytes.Buffer
	writer := zip.NewWriter(&buffer)
	for _, file := range files {
		body := []byte(file.data)
		// Generated filenames are short; artifact limits keep entries below ZIP64.
		if uint64(len(body)) >= 1<<32-1 {
			return nil, &Error{http.StatusConflict, "내보낼 파일이 너무 큽니다."}
		}
		header := &zip.FileHeader{
			Name: file.name, Method: zip.Store, Flags: 0x0800, CreatorVersion: 20, ReaderVersion: 20,
			CRC32:            crc32.ChecksumIEEE(body),
			CompressedSize64: uint64(len(body)), UncompressedSize64: uint64(len(body)),
		}
		entry, err := writer.CreateRaw(header)
		if err != nil {
			return nil, err
		}
		if _, err = entry.Write(body); err != nil {
			return nil, err
		}
	}
	if err := writer.Close(); err != nil {
		return nil, err
	}
	return buffer.Bytes(), nil
}
