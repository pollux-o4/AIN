package artifacts

import (
	"unicode"

	"github.com/yuin/goldmark/ast"
	gfm "github.com/yuin/goldmark/extension/ast"
	"github.com/yuin/goldmark/parser"
	"github.com/yuin/goldmark/text"
	"github.com/yuin/goldmark/util"
)

// Keep Markdown delimiters adjacent to Korean particles and CJK punctuation usable.
type cjkDelimiter struct{}

func (cjkDelimiter) Trigger() []byte            { return []byte{'*', '_', '~'} }
func (cjkDelimiter) IsDelimiter(mark byte) bool { return mark == '*' || mark == '_' || mark == '~' }
func (cjkDelimiter) CanOpenCloser(opener, closer *parser.Delimiter) bool {
	return opener.Char == closer.Char
}
func (cjkDelimiter) OnMatch(size int) ast.Node { return ast.NewEmphasis(size) }

type strikeDelimiter struct{ cjkDelimiter }

func (strikeDelimiter) OnMatch(int) ast.Node { return gfm.NewStrikethrough() }

func (p cjkDelimiter) Parse(_ ast.Node, block text.Reader, context parser.Context) ast.Node {
	before := block.PrecendingCharacter()
	line, segment := block.PeekLine()
	mark := line[0]
	var processor parser.DelimiterProcessor = p
	minimum := 1
	if mark == '~' {
		processor, minimum = strikeDelimiter{p}, 2
		if before == '~' {
			return nil
		}
	}
	node := parser.ScanDelimiter(line, before, minimum, processor)
	if node == nil || mark == '~' && node.OriginalLength != 2 {
		return nil
	}
	after := ' '
	if node.Length < len(line) {
		after = util.ToRune(line, node.Length)
	}
	leftSpace, rightSpace := util.IsSpaceRune(before), util.IsSpaceRune(after)
	if leftSpace || rightSpace {
		node.CanOpen, node.CanClose = !rightSpace, !leftSpace
	} else if mark == '_' {
		node.CanOpen, node.CanClose = util.IsPunctRune(before), util.IsPunctRune(after)
	} else if isCJK(before) || isCJK(after) {
		node.CanOpen, node.CanClose = true, true
	}
	node.Segment = segment.WithStop(segment.Start + node.OriginalLength)
	block.Advance(node.OriginalLength)
	context.PushDelimiter(node)
	return node
}

func isCJK(r rune) bool {
	return unicode.In(r, unicode.Hangul, unicode.Han, unicode.Hiragana, unicode.Katakana, unicode.Bopomofo) ||
		r >= 0x3000 && r <= 0x303f || r >= 0xff01 && r <= 0xffee
}
