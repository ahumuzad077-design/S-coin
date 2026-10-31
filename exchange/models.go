package exchange

import "time"

type Principal struct {
	Subject        string
	Email          string
	EmailVerified  bool
	OrganizationID string
	Roles          map[string]struct{}
}

func (p Principal) HasRole(role string) bool {
	_, ok := p.Roles[role]
	return ok
}

type IssuerApplicationInput struct {
	LegalName             string `json:"legalName"`
	RegistrationCountry   string `json:"registrationCountry"`
	RegistrationNumber    string `json:"registrationNumber"`
	RegisteredAddress     string `json:"registeredAddress"`
	Website               string `json:"website"`
	ApplicantEmail        string `json:"applicantEmail"`
	ApplicantPhone        string `json:"applicantPhone"`
	ProposedSecurityType  string `json:"proposedSecurityType"`
	ProposedMarketSegment string `json:"proposedMarketSegment"`
	BusinessDescription   string `json:"businessDescription"`
	CapitalSeekingMinor   int64  `json:"capitalSeekingMinor"`
	Currency              string `json:"currency"`
}

type IssuerApplication struct {
	ID                    string    `json:"id"`
	LegalName             string    `json:"legalName"`
OrganisationVerificationStatus string `json:"organisationVerificationStatus"`
	RegistrationCountry   string    `json:"registrationCountry"`
	RegistrationNumber    string    `json:"registrationNumber"`
	RegisteredAddress     string    `json:"registeredAddress"`
	Website               string    `json:"website"`
	ApplicantEmail        string    `json:"applicantEmail"`
	ApplicantPhone        string    `json:"applicantPhone"`
	ProposedSecurityType  string    `json:"proposedSecurityType"`
	ProposedMarketSegment string    `json:"proposedMarketSegment"`
	BusinessDescription   string    `json:"businessDescription"`
	CapitalSeekingMinor   int64     `json:"capitalSeekingMinor"`
	Currency              string    `json:"currency"`
	Status                string    `json:"status"`
	SubmittedBy           string    `json:"submittedBy"`
	AssignedTo            string    `json:"assignedTo,omitempty"`
	CreatedAt             time.Time `json:"createdAt"`
	UpdatedAt             time.Time `json:"updatedAt"`
}

type ReviewDecisionInput struct {
	Decision string `json:"decision"`
	Reason   string `json:"reason"`
}

type ApplicationEvent struct {
	ID             string    `json:"id"`
	ApplicationID  string    `json:"applicationId"`
	ActorSubject   string    `json:"actorSubject"`
	ActorRole      string    `json:"actorRole"`
	EventType      string    `json:"eventType"`
	PreviousStatus string    `json:"previousStatus,omitempty"`
	NewStatus      string    `json:"newStatus,omitempty"`
	Reason         string    `json:"reason,omitempty"`
	OccurredAt     time.Time `json:"occurredAt"`
}

type ExchangeStatus struct {
	OperatorName             string `json:"operatorName"`
	RegulatoryApprovalStatus string `json:"regulatoryApprovalStatus"`
	ApprovalReference        string `json:"approvalReference,omitempty"`
	TradingEnabled           bool   `json:"tradingEnabled"`
	Reason                   string `json:"reason"`
}
