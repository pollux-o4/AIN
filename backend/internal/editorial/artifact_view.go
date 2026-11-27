package editorial

import "encoding/json"

var writingStages = []struct{ key, name string }{
	{"diagnose", "진단"}, {"topic", "주제 정리"}, {"audience", "독자 정리"},
	{"value", "핵심 정리"}, {"research", "근거 정리"}, {"outline", "구성"},
	{"draft", "초고 작성"}, {"review", "검토"},
}

type artifactView struct {
	Stage              string                     `json:"stage"`
	Name               string                     `json:"name"`
	Revision           int64                      `json:"revision"`
	ReusedFromRevision *int64                     `json:"reusedFromRevision,omitempty"`
	Output             map[string]json.RawMessage `json:"output"`
}

func projectArtifacts(stored map[string]json.RawMessage, revision int64, presented bool) ([]artifactView, []string) {
	artifacts := make([]artifactView, 0, len(writingStages))
	findings := []string{}
	for _, stage := range writingStages {
		var item artifactView
		if json.Unmarshal(stored[stage.key], &item) != nil || item.Revision != revision || item.Output == nil {
			continue
		}
		item.Stage, item.Name = stage.key, stage.name
		artifacts = append(artifacts, item)
		if presented && stage.key == "review" {
			var review []string
			if json.Unmarshal(item.Output["findings"], &review) == nil && review != nil {
				findings = review
			}
		}
	}
	return artifacts, findings
}
