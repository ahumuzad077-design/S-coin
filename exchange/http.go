package exchange

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"regexp"
	"strconv"
	"strings"
)

type principalContextKey struct{}

func principalFromContext(ctx context.Context) (Principal, bool) {
	p, ok := ctx.Value(principalContextKey{}).(Principal)
	return p, ok
}

var applicationIDPattern = regexp.MustCompile("^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$")

func NewHTTPHandler(store Store, auth Authenticator, legalName string) http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/healthz", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet {
			methodNotAllowed(w, http.MethodGet)
			return
		}
		writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
	})
	mux.HandleFunc("/v1/exchange/status", func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet { methodNotAllowed(w, http.MethodGet); return }
		p, _ := principalFromContext(r.Context())
		if !p.HasRole("ISSUER_APPLICANT") && !p.HasRole("EXCHANGE_REVIEW_OFFICER") &&
			!p.HasRole("EXCHANGE_COMPLIANCE") && !p.HasRole("EXCHANGE_ADMIN") {
			writeError(w, http.StatusForbidden, "forbidden", "Your account is not authorised for this resource.")
			return
		}
		status, err := store.GetExchangeStatus(r.Context(), legalName)
		if err != nil { writeError(w, http.StatusInternalServerError, "internal_error", "Exchange status could not be retrieved."); return }
		writeJSON(w, http.StatusOK, status)
	})
	mux.HandleFunc("/v1/issuer-applications", func(w http.ResponseWriter, r *http.Request) {
		p, _ := principalFromContext(r.Context())
		switch r.Method {
		case http.MethodPost:
			if !p.HasRole("ISSUER_APPLICANT") { writeError(w, http.StatusForbidden, "forbidden", "Issuer applicant access is required."); return }
			if !p.EmailVerified || !strings.EqualFold(strings.TrimSpace(input.ApplicantEmail), strings.TrimSpace(p.Email)) { writeError(w, http.StatusUnprocessableEntity, "verified_email_required", "Use the email address verified by your identity provider."); return }
			var input IssuerApplicationInput
			if err := decodeJSON(w, r, &input, 64*1024); err != nil { writeError(w, http.StatusBadRequest, "invalid_json", "Provide one valid issuer application JSON object."); return }
			if err := ValidateIssuerApplication(input); err != nil { writeError(w, http.StatusUnprocessableEntity, "invalid_application", "Check the required company registration, contact, security and capital-raising fields."); return }
			requestID, err := newRequestID()
			if err != nil { writeError(w, http.StatusInternalServerError, "request_id_failed", "The request could not be safely recorded."); return }
			created, err := store.CreateIssuerApplication(r.Context(), p, input, requestID)
			if err != nil { writeStoreError(w, err); return }
			writeJSON(w, http.StatusCreated, created)
		case http.MethodGet:
			if !p.HasRole("EXCHANGE_REVIEW_OFFICER") && !p.HasRole("EXCHANGE_COMPLIANCE") && !p.HasRole("EXCHANGE_ADMIN") {
				writeError(w, http.StatusForbidden, "forbidden", "Exchange reviewer access is required to list issuer applications.")
				return
			}
			status := strings.TrimSpace(r.URL.Query().Get("status"))
			if status != "" && !validApplicationStatus(status) { writeError(w, http.StatusBadRequest, "invalid_status", "Unsupported application status filter."); return }
			limit := 50
			if raw := r.URL.Query().Get("limit"); raw != "" {
				parsed, err := strconv.Atoi(raw)
				if err != nil || parsed < 1 || parsed > 100 { writeError(w, http.StatusBadRequest, "invalid_limit", "Limit must be between 1 and 100."); return }
				limit = parsed
			}
			applications, err := store.ListIssuerApplications(r.Context(), status, limit)
			if err != nil { writeError(w, http.StatusInternalServerError, "internal_error", "Issuer applications could not be listed."); return }
			writeJSON(w, http.StatusOK, map[string]any{"applications": applications, "count": len(applications)})
		default:
			methodNotAllowed(w, http.MethodGet+", "+http.MethodPost)
		}
	})
	mux.HandleFunc("/v1/issuer-applications/", func(w http.ResponseWriter, r *http.Request) {
		p, _ := principalFromContext(r.Context())
		path := strings.Trim(strings.TrimPrefix(r.URL.Path, "/v1/issuer-applications/"), "/")
		parts := strings.Split(path, "/")
		if len(parts) < 1 || !applicationIDPattern.MatchString(parts[0]) { http.NotFound(w, r); return }
		id := parts[0]
		isReviewer := p.HasRole("EXCHANGE_REVIEW_OFFICER") || p.HasRole("EXCHANGE_COMPLIANCE") || p.HasRole("EXCHANGE_ADMIN")
		application, err := store.GetIssuerApplication(r.Context(), id)
		if err != nil { writeStoreError(w, err); return }
		if !isReviewer && application.SubmittedBy != p.Subject {
			writeError(w, http.StatusNotFound, "not_found", "Issuer application was not found.")
			return
		}
		if len(parts) == 1 && r.Method == http.MethodGet {
			writeJSON(w, http.StatusOK, application)
			return
		}
		if len(parts) == 2 && parts[1] == "events" && r.Method == http.MethodGet {
			events, err := store.ListApplicationEvents(r.Context(), id)
			if err != nil { writeError(w, http.StatusInternalServerError, "internal_error", "Application history could not be retrieved."); return }
			writeJSON(w, http.StatusOK, map[string]any{"events": events, "count": len(events)})
			return
		}
		if len(parts) == 2 && parts[1] == "decisions" && r.Method == http.MethodPost {
			if !p.HasRole("EXCHANGE_REVIEW_OFFICER") && !p.HasRole("EXCHANGE_COMPLIANCE") && !p.HasRole("EXCHANGE_ADMIN") {
				writeError(w, http.StatusForbidden, "forbidden", "Exchange review authority is required.")
				return
			}
			var decision ReviewDecisionInput
			if err := decodeJSON(w, r, &decision, 16*1024); err != nil || ValidateReviewDecision(decision) != nil {
				writeError(w, http.StatusUnprocessableEntity, "invalid_decision", "Provide a permitted review decision and a reason of at least 10 characters.")
				return
			}
			requestID, err := newRequestID()
			if err != nil { writeError(w, http.StatusInternalServerError, "request_id_failed", "The request could not be safely recorded."); return }
			updated, err := store.DecideIssuerApplication(r.Context(), p, id, decision, requestID)
			if err != nil { writeStoreError(w, err); return }
			writeJSON(w, http.StatusOK, updated)
			return
		}
		if r.Method != http.MethodGet && r.Method != http.MethodPost {
			methodNotAllowed(w, http.MethodGet+", "+http.MethodPost)
			return
		}
		http.NotFound(w, r)
	})

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("Referrer-Policy", "no-referrer")
		w.Header().Set("X-Frame-Options", "DENY")
		if r.URL.Path == "/healthz" { mux.ServeHTTP(w, r); return }
		if auth == nil {
			writeError(w, http.StatusServiceUnavailable, "authentication_unavailable", "Identity verification is not configured.")
			return
		}
		principal, err := auth.Authenticate(r.Context(), r)
		if err != nil {
			w.Header().Set("WWW-Authenticate", "Bearer")
			writeError(w, http.StatusUnauthorized, "unauthenticated", "A valid identity-provider bearer token is required.")
			return
		}
		if strings.TrimSpace(principal.Subject) == "" {
			writeError(w, http.StatusUnauthorized, "unauthenticated", "The authenticated identity has no subject.")
			return
		}
		ctx := context.WithValue(r.Context(), principalContextKey{}, principal)
		mux.ServeHTTP(w, r.WithContext(ctx))
	})
}

func validApplicationStatus(status string) bool {
	switch status {
	case "SUBMITTED", "UNDER_REVIEW", "INFORMATION_REQUESTED", "DUE_DILIGENCE", "DECLINED":
		return true
	default:
		return false
	}
}

func decodeJSON(w http.ResponseWriter, r *http.Request, target any, maxBytes int64) error {
	if !strings.HasPrefix(strings.ToLower(r.Header.Get("Content-Type")), "application/json") { return errors.New("content type must be application/json") }
	r.Body = http.MaxBytesReader(w, r.Body, maxBytes)
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(target); err != nil { return err }
	var extra any
	if err := decoder.Decode(&extra); !errors.Is(err, io.EOF) { return errors.New("request must contain one JSON value") }
	return nil
}

func newRequestID() (string, error) {
	var value [16]byte
	if _, err := rand.Read(value[:]); err != nil { return "", err }
	return hex.EncodeToString(value[:]), nil
}

func methodNotAllowed(w http.ResponseWriter, allowed string) {
	w.Header().Set("Allow", allowed)
	writeError(w, http.StatusMethodNotAllowed, "method_not_allowed", "HTTP method is not supported.")
}

func writeStoreError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, ErrNotFound):
		writeError(w, http.StatusNotFound, "not_found", "The requested record was not found.")
	case errors.Is(err, ErrConflict):
		writeError(w, http.StatusConflict, "conflict", "A company with the same official registration has already been submitted.")
	case errors.Is(err, ErrInvalidTransition):
		writeError(w, http.StatusConflict, "invalid_transition", "That review decision is not permitted from the current application status.")
	case errors.Is(err, ErrForbidden):
		writeError(w, http.StatusForbidden, "forbidden", "You are not authorised for this operation.")
	default:
		writeError(w, http.StatusInternalServerError, "internal_error", "The exchange operations service could not complete the request.")
	}
}

func writeError(w http.ResponseWriter, status int, code, message string) {
	writeJSON(w, status, map[string]any{"error": map[string]string{"code": code, "message": message}})
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}
