package exchange

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

type testAuthenticator struct { principal Principal }
func (a testAuthenticator) Authenticate(context.Context, *http.Request) (Principal, error) { return a.principal, nil }

type testStore struct {
	application IssuerApplication
	created bool
	decisionCalls int
}

func (s *testStore) CreateIssuerApplication(_ context.Context, p Principal, in IssuerApplicationInput, _ string) (IssuerApplication, error) {
	s.created = true
	s.application = IssuerApplication{
		ID: "2db3c8f4-6b7e-4a1d-8b09-0e6fdbcc5f10",
		LegalName: in.LegalName,
		RegistrationCountry: in.RegistrationCountry,
		RegistrationNumber: in.RegistrationNumber,
		ApplicantEmail: in.ApplicantEmail,
		ProposedSecurityType: in.ProposedSecurityType,
		Status: "SUBMITTED",
		SubmittedBy: p.Subject,
		CreatedAt: time.Now().UTC(),
	}
	return s.application, nil
}
func (s *testStore) GetIssuerApplication(context.Context, string) (IssuerApplication, error) {
	return s.application, nil
}
func (s *testStore) ListIssuerApplications(context.Context, string, int) ([]IssuerApplication, error) {
	return []IssuerApplication{s.application}, nil
}
func (s *testStore) ListApplicationEvents(context.Context, string) ([]ApplicationEvent, error) {
	return []ApplicationEvent{}, nil
}
func (s *testStore) DecideIssuerApplication(_ context.Context, p Principal, _ string, d ReviewDecisionInput, _ string) (IssuerApplication, error) {
	s.decisionCalls++
	next, err := NextApplicationStatus(s.application.Status, d.Decision)
	if err != nil { return IssuerApplication{}, err }
	s.application.Status = next
	return s.application, nil
}
func (s *testStore) GetExchangeStatus(context.Context, string) (ExchangeStatus, error) {
	return ExchangeStatus{OperatorName:"", RegulatoryApprovalStatus:"NOT_RECORDED", TradingEnabled:false}, nil
}
func (s *testStore) Close() error { return nil }

func TestIssuerApplicationEndpointRequiresVerifiedApplicant(t *testing.T) {
	store := &testStore{}
	principal := Principal{Subject:"issuer-1", Email:"director@company.example", EmailVerified:true, Roles:map[string]struct{}{"ISSUER_APPLICANT":{}}}
	handler := NewHTTPHandler(store, testAuthenticator{principal}, "MERIDIAN MARKET OPERATOR")
	body := `{"legalName":"Company Limited","registrationCountry":"UG","registrationNumber":"REG-10001","registeredAddress":"Kampala, Uganda","website":"https://company.example","applicantEmail":"director@company.example","applicantPhone":"+256700000000","proposedSecurityType":"EQUITY","proposedMarketSegment":"GROWTH","businessDescription":"A company with a business model and a documented plan to raise capital for its operating activities.","capitalSeekingMinor":1000000000,"currency":"UGX"}`
	request := httptest.NewRequest(http.MethodPost, "/v1/issuer-applications", strings.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Authorization", "Bearer valid-for-test")
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusCreated || !store.created {
		t.Fatalf("expected real application submission, got status %d: %s", response.Code, response.Body.String())
	}
}

func TestIssuerApplicationEndpointRejectsUnverifiedEmail(t *testing.T) {
	store := &testStore{}
	principal := Principal{Subject:"issuer-1", Email:"director@company.example", EmailVerified:false, Roles:map[string]struct{}{"ISSUER_APPLICANT":{}}}
	handler := NewHTTPHandler(store, testAuthenticator{principal}, "MERIDIAN MARKET OPERATOR")
	body := `{"legalName":"Company Limited","registrationCountry":"UG","registrationNumber":"REG-10001","registeredAddress":"Kampala, Uganda","website":"","applicantEmail":"director@company.example","applicantPhone":"+256700000000","proposedSecurityType":"EQUITY","proposedMarketSegment":"GROWTH","businessDescription":"A company with a business model and a documented plan to raise capital for its operating activities.","capitalSeekingMinor":1000000000,"currency":"UGX"}`
	request := httptest.NewRequest(http.MethodPost, "/v1/issuer-applications", strings.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusUnprocessableEntity || store.created {
		t.Fatalf("unverified email must be rejected, got status %d", response.Code)
	}
}

func TestIssuerCannotReadAnotherApplicantsApplication(t *testing.T) {
	store := &testStore{application:IssuerApplication{ID:"2db3c8f4-6b7e-4a1d-8b09-0e6fdbcc5f10",SubmittedBy:"different-issuer"}}
	principal := Principal{Subject:"issuer-1", EmailVerified:true, Roles:map[string]struct{}{"ISSUER_APPLICANT":{}}}
	handler := NewHTTPHandler(store, testAuthenticator{principal}, "MERIDIAN MARKET OPERATOR")
	request := httptest.NewRequest(http.MethodGet, "/v1/issuer-applications/2db3c8f4-6b7e-4a1d-8b09-0e6fdbcc5f10", nil)
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusNotFound {
		t.Fatalf("cross-applicant access must be hidden, got status %d", response.Code)
	}
}

func TestReviewEndpointRequiresReviewRoleAndValidTransition(t *testing.T) {
	store := &testStore{application:IssuerApplication{ID:"2db3c8f4-6b7e-4a1d-8b09-0e6fdbcc5f10",SubmittedBy:"issuer-1",Status:"SUBMITTED"}}
	principal := Principal{Subject:"reviewer-1", EmailVerified:true, Roles:map[string]struct{}{"EXCHANGE_REVIEW_OFFICER":{}}}
	handler := NewHTTPHandler(store, testAuthenticator{principal}, "MERIDIAN MARKET OPERATOR")
	request := httptest.NewRequest(http.MethodPost, "/v1/issuer-applications/2db3c8f4-6b7e-4a1d-8b09-0e6fdbcc5f10/decisions", strings.NewReader(`{"decision":"START_REVIEW","reason":"The company submission has been received for initial eligibility screening."}`))
	request.Header.Set("Content-Type", "application/json")
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusOK || store.decisionCalls != 1 {
		t.Fatalf("authorised review decision failed: status=%d body=%s", response.Code, response.Body.String())
	}
	var application IssuerApplication
	if err := json.Unmarshal(response.Body.Bytes(), &application); err != nil || application.Status != "UNDER_REVIEW" {
		t.Fatalf("expected UNDER_REVIEW response, got %+v err=%v", application, err)
	}
}

func TestExchangeStatusNeverEnablesTradingFromApprovalRecordAlone(t *testing.T) {
	store := &testStore{}
	handler := NewHTTPHandler(store, testAuthenticator{Principal{Subject:"reviewer",Roles:map[string]struct{}{"EXCHANGE_ADMIN":{}}}}, "MERIDIAN MARKET OPERATOR")
	request := httptest.NewRequest(http.MethodGet, "/v1/exchange/status", nil)
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	var status ExchangeStatus
	if err := json.Unmarshal(response.Body.Bytes(), &status); err != nil {
		t.Fatal(err)
	}
	if status.TradingEnabled {
		t.Fatal("issuer operations service must not enable securities trading")
	}
}
