package exchange

import (
	"errors"
	"net/mail"
	"net/url"
	"regexp"
	"strings"
	"unicode/utf8"
)

var (
	ErrInvalidInput      = errors.New("invalid request")
	ErrNotFound          = errors.New("record not found")
	ErrForbidden         = errors.New("not authorised")
	ErrConflict          = errors.New("record conflict")
	ErrInvalidTransition = errors.New("invalid status transition")
)

var registrationNumberPattern = regexp.MustCompile("^[A-Za-z0-9][A-Za-z0-9./-]{1,63}$")
var countryCodePattern = regexp.MustCompile("^[A-Z]{2}$")

var validSecurityTypes = map[string]struct{}{
	"EQUITY": {}, "CORPORATE_BOND": {}, "INFRASTRUCTURE_BOND": {},
	"GREEN_BOND": {}, "SUKUK": {}, "OTHER": {},
}

var validMarketSegments = map[string]struct{}{
	"MAIN": {}, "GROWTH": {}, "DEBT": {}, "INFRASTRUCTURE": {},
}

func ValidateIssuerApplication(in IssuerApplicationInput) error {
	if !validText(in.LegalName, 3, 200) ||
		!countryCodePattern.MatchString(strings.ToUpper(strings.TrimSpace(in.RegistrationCountry))) ||
		!registrationNumberPattern.MatchString(strings.TrimSpace(in.RegistrationNumber)) ||
		!validText(in.RegisteredAddress, 5, 500) ||
		!validText(in.ApplicantEmail, 5, 254) ||
		!validText(in.ApplicantPhone, 5, 40) ||
		!validText(in.BusinessDescription, 30, 10000) {
		return ErrInvalidInput
	}
	if _, err := mail.ParseAddress(strings.TrimSpace(in.ApplicantEmail)); err != nil {
		return ErrInvalidInput
	}
	if in.Website != "" {
		u, err := url.ParseRequestURI(strings.TrimSpace(in.Website))
		if err != nil || (u.Scheme != "https" && u.Scheme != "http") || u.Host == "" {
			return ErrInvalidInput
		}
	}
	if _, ok := validSecurityTypes[in.ProposedSecurityType]; !ok {
		return ErrInvalidInput
	}
	if _, ok := validMarketSegments[in.ProposedMarketSegment]; !ok {
		return ErrInvalidInput
	}
	if in.CapitalSeekingMinor < 0 || in.CapitalSeekingMinor > 9_000_000_000_000_000 {
		return ErrInvalidInput
	}
	if in.Currency != "UGX" && in.Currency != "USD" && in.Currency != "EUR" && in.Currency != "KES" && in.Currency != "TZS" && in.Currency != "RWF" {
		return ErrInvalidInput
	}
	return nil
}

func validText(value string, min, max int) bool {
	value = strings.TrimSpace(value)
	n := utf8.RuneCountInString(value)
	return n >= min && n <= max
}

func ValidateCompanyVerification(input CompanyVerificationInput) error {
	if input.Decision != "VERIFIED" && input.Decision != "REJECTED" {
		return ErrInvalidInput
	}
	if !validText(input.Reason, 10, 4000) {
		return ErrInvalidInput
	}
	u, err := url.ParseRequestURI(strings.TrimSpace(input.RegistryEvidenceURL))
	if err != nil || u.Scheme != "https" || u.Host == "" {
		return ErrInvalidInput
	}
	return nil
}

func ValidateReviewDecision(input ReviewDecisionInput) error {
	if !validText(input.Reason, 10, 4000) {
		return ErrInvalidInput
	}
	switch input.Decision {
	case "START_REVIEW", "REQUEST_INFORMATION", "DUE_DILIGENCE", "DECLINE":
		return nil
	default:
		return ErrInvalidInput
	}
}

func NextApplicationStatus(current, decision string) (string, error) {
	switch current {
	case "SUBMITTED":
		switch decision {
		case "START_REVIEW":
			return "UNDER_REVIEW", nil
		case "REQUEST_INFORMATION":
			return "INFORMATION_REQUESTED", nil
		case "DECLINE":
			return "DECLINED", nil
		}
	case "INFORMATION_REQUESTED":
		switch decision {
		case "START_REVIEW":
			return "UNDER_REVIEW", nil
		case "DECLINE":
			return "DECLINED", nil
		}
	case "UNDER_REVIEW":
		switch decision {
		case "REQUEST_INFORMATION":
			return "INFORMATION_REQUESTED", nil
		case "DUE_DILIGENCE":
			return "DUE_DILIGENCE", nil
		case "DECLINE":
			return "DECLINED", nil
		}
	case "DUE_DILIGENCE":
		switch decision {
		case "REQUEST_INFORMATION":
			return "INFORMATION_REQUESTED", nil
		case "DECLINE":
			return "DECLINED", nil
		}
	}
	return "", ErrInvalidTransition
}
