package writing

import "github.com/pollux-o4/AIN/backend/internal/contract"

type ApprovalAvailability struct {
	Satisfy, Authorize bool
}

func (rules *Rules) Approvals(run contract.Run) ApprovalAvailability {
	_, state, err := decodeRecord(run)
	if err != nil || rules.issue(state) != "" {
		return ApprovalAvailability{}
	}
	return ApprovalAvailability{
		Satisfy:   str(state["status"]) == "awaiting_user" && !hasBlockingUnmet(state),
		Authorize: canAuthorize(state),
	}
}

func hasBlockingUnmet(state object) bool {
	for _, item := range array(state["unmet"]) {
		if obj(item)["kind"] != "review" {
			return true
		}
	}
	return false
}

func canAuthorize(state object) bool {
	return str(state["status"]) == "satisfied" && intValue(state["satisfiedRevision"]) == intValue(state["revision"])
}
