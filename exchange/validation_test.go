package exchange

import "testing"

func TestValidateIssuerApplicationAcceptsCompanySubmission(t *testing.T) {
	input := IssuerApplicationInput{
		LegalName: "Northern Grid Infrastructure Limited",
		RegistrationCountry: "UG",
		RegistrationNumber: "80020004567890",
		RegisteredAddress: "Plot 18, Industrial Area, Kampala",
		Website: "https://northerngrid.example",
		ApplicantEmail: "capital@northerngrid.example",
		ApplicantPhone: "+256700000000",
		ProposedSecurityType: "INFRASTRUCTURE_BOND",
		ProposedMarketSegment: "INFRASTRUCTURE",
		BusinessDescription: "The company develops and operates electricity transmission and distribution infrastructure for industrial and commercial customers.",
		CapitalSeekingMinor: 250000000000,
		Currency: "UGX",
	}
	if err := ValidateIssuerApplication(input); err != nil {
		t.Fatalf("valid issuer application rejected: %v", err)
	}
}

func TestValidateIssuerApplicationRejectsUnsupportedFields(t *testing.T) {
	input := IssuerApplicationInput{
		LegalName: "A Company Limited",
		RegistrationCountry: "UG",
		RegistrationNumber: "ABC-123",
		RegisteredAddress: "Kampala",
		ApplicantEmail: "person@example.com",
		ApplicantPhone: "+256700000000",
		ProposedSecurityType: "TOKEN",
		ProposedMarketSegment: "MAIN",
		BusinessDescription: "A sufficiently long description of the company activities and its proposed business.",
		CapitalSeekingMinor: 1000000,
		Currency: "UGX",
	}
	if err := ValidateIssuerApplication(input); err == nil {
		t.Fatal("unsupported security type must be rejected")
	}
}

func TestReviewDecisionsRespectApplicationLifecycle(t *testing.T) {
	steps := []struct{ current, decision, expected string }{
		{"SUBMITTED", "START_REVIEW", "UNDER_REVIEW"},
		{"UNDER_REVIEW", "REQUEST_INFORMATION", "INFORMATION_REQUESTED"},
		{"INFORMATION_REQUESTED", "START_REVIEW", "UNDER_REVIEW"},
		{"UNDER_REVIEW", "DUE_DILIGENCE", "DUE_DILIGENCE"},
		{"DUE_DILIGENCE", "REQUEST_INFORMATION", "INFORMATION_REQUESTED"},
	}
	for _, step := range steps {
		got, err := NextApplicationStatus(step.current, step.decision)
		if err != nil || got != step.expected {
			t.Fatalf("%s + %s: got %q, err %v; want %q", step.current, step.decision, got, err, step.expected)
		}
	}
}

func TestIssuerCannotSelfApproveAdmissionOrBypassReview(t *testing.T) {
	for _, step := range []struct{ current, decision string }{
		{"SUBMITTED", "ADMIT"},
		{"SUBMITTED", "DUE_DILIGENCE"},
		{"DECLINED", "START_REVIEW"},
		{"DUE_DILIGENCE", "ADMIT"},
	} {
		if _, err := NextApplicationStatus(step.current, step.decision); err == nil {
			t.Fatalf("unexpected transition accepted: %s + %s", step.current, step.decision)
		}
	}
}
