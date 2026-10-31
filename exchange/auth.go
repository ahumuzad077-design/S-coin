package exchange

import (
	"context"
	"errors"
	"net/http"
	"net/url"
	"strings"

	"github.com/coreos/go-oidc/v3/oidc"
)

type Authenticator interface {
	Authenticate(context.Context, *http.Request) (Principal, error)
}

type OIDCAuthenticator struct {
	verifier *oidc.IDTokenVerifier
}

func NewOIDCAuthenticator(ctx context.Context, issuerURL, clientID string) (*OIDCAuthenticator, error) {
	parsed, err := url.Parse(issuerURL)
	if err != nil || parsed.Scheme != "https" || parsed.Host == "" || clientID == "" {
		return nil, errors.New("OIDC issuer must be HTTPS and client ID must be configured")
	}
	provider, err := oidc.NewProvider(ctx, issuerURL)
	if err != nil {
		return nil, errors.New("could not discover configured OIDC provider")
	}
	return &OIDCAuthenticator{
		verifier: provider.VerifierContext(ctx, &oidc.Config{ClientID: clientID}),
	}, nil
}

func (a *OIDCAuthenticator) Authenticate(ctx context.Context, r *http.Request) (Principal, error) {
	header := strings.TrimSpace(r.Header.Get("Authorization"))
	parts := strings.SplitN(header, " ", 2)
	if len(parts) != 2 || !strings.EqualFold(parts[0], "Bearer") || strings.TrimSpace(parts[1]) == "" {
		return Principal{}, errors.New("missing bearer token")
	}
	token, err := a.verifier.Verify(ctx, strings.TrimSpace(parts[1]))
	if err != nil {
		return Principal{}, errors.New("identity token verification failed")
	}
	var claims struct {
		Subject        string   `json:"sub"`
		Email          string   `json:"email"`
		EmailVerified  bool     `json:"email_verified"`
		OrganizationID string   `json:"organization_id"`
		Roles          []string `json:"roles"`
		Groups         []string `json:"groups"`
	}
	if err := token.Claims(&claims); err != nil || strings.TrimSpace(claims.Subject) == "" {
		return Principal{}, errors.New("identity token has invalid claims")
	}
	roles := make(map[string]struct{})
	for _, role := range append(claims.Roles, claims.Groups...) {
		switch role {
		case "ISSUER_APPLICANT", "EXCHANGE_REVIEW_OFFICER", "EXCHANGE_COMPLIANCE", "EXCHANGE_ADMIN":
			roles[role] = struct{}{}
		}
	}
	return Principal{
		Subject: strings.TrimSpace(claims.Subject),
		Email: strings.TrimSpace(claims.Email),
		EmailVerified: claims.EmailVerified,
		OrganizationID: strings.TrimSpace(claims.OrganizationID),
		Roles: roles,
	}, nil
}
