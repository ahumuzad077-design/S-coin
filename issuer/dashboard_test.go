package issuer

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

type dashboardFixture struct {
	snapshot DashboardSnapshot
	err      error
	calls    int
}

func (f *dashboardFixture) ReadReserveDashboard(context.Context) (DashboardSnapshot, error) {
	f.calls++
	return f.snapshot, f.err
}

type dashboardSecurityFixture struct {
	secure bool
	allow  bool
	role   bool
}

func (f dashboardSecurityFixture) IsSecureTransport(*http.Request) bool { return f.secure }
func (f dashboardSecurityFixture) AllowRequest(*http.Request) bool      { return f.allow }
func (f dashboardSecurityFixture) HasRole(*http.Request, string) bool   { return f.role }

func TestDashboardRequiresSecurityAndShowsOnlyInjectedSnapshot(t *testing.T) {
	fixture := &dashboardFixture{snapshot: DashboardSnapshot{
		AsOf: time.Date(2026, 10, 31, 0, 0, 0, 0, time.UTC),
		Assets: []DashboardAsset{{
			AssetCode: "SQM-UGX", FiatCurrency: "UGX",
			ConfirmedReserveMinorUnits:  "fixture-confirmed",
			RestrictedReserveMinorUnits: "fixture-restricted",
			PendingDepositMinorUnits:    "fixture-pending",
			ReconciliationStatus:        "fixture-verified",
			IssuanceSuspended:           true,
		}},
	}}
	handler, err := NewReserveDashboardHandler(fixture, dashboardSecurityFixture{
		secure: true, allow: true, role: true,
	})
	if err != nil {
		t.Fatal(err)
	}
	request := httptest.NewRequest(http.MethodGet, "/admin/reserves", nil)
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("authorized fixture should render: %d %s", response.Code, response.Body)
	}
	for _, value := range []string{"fixture-confirmed", "fixture-restricted", "fixture-pending", "DISABLED", "fixture-verified"} {
		if !strings.Contains(response.Body.String(), value) {
			t.Errorf("dashboard omitted source-provided field %q", value)
		}
	}
	if response.Header().Get("Cache-Control") != "no-store" ||
		response.Header().Get("X-Frame-Options") != "DENY" {
		t.Fatal("administrative response security headers are missing")
	}
	if fixture.calls != 1 {
		t.Fatalf("expected one authorized data read, got %d", fixture.calls)
	}
}

func TestDashboardFailsClosedBeforeReadingData(t *testing.T) {
	fixture := &dashboardFixture{snapshot: DashboardSnapshot{
		AsOf: time.Now(), Assets: []DashboardAsset{{AssetCode: "fixture"}},
	}}
	for _, test := range []struct {
		name     string
		security dashboardSecurityFixture
		method   string
		want     int
	}{
		{name: "insecure transport", security: dashboardSecurityFixture{allow: true, role: true}, method: http.MethodGet, want: http.StatusForbidden},
		{name: "rate limited", security: dashboardSecurityFixture{secure: true, role: true}, method: http.MethodGet, want: http.StatusTooManyRequests},
		{name: "not authorized", security: dashboardSecurityFixture{secure: true, allow: true}, method: http.MethodGet, want: http.StatusUnauthorized},
		{name: "method disallowed", security: dashboardSecurityFixture{secure: true, allow: true, role: true}, method: http.MethodPost, want: http.StatusMethodNotAllowed},
	} {
		t.Run(test.name, func(t *testing.T) {
			handler, err := NewReserveDashboardHandler(fixture, test.security)
			if err != nil {
				t.Fatal(err)
			}
			response := httptest.NewRecorder()
			handler.ServeHTTP(response, httptest.NewRequest(test.method, "/admin/reserves", nil))
			if response.Code != test.want {
				t.Fatalf("got status %d, want %d", response.Code, test.want)
			}
		})
	}
	if fixture.calls != 0 {
		t.Fatalf("unauthorized requests must not read reserve data, reads=%d", fixture.calls)
	}
}

func TestDashboardDoesNotRenderMissingOrUnavailableDataAsZero(t *testing.T) {
	for _, fixture := range []*dashboardFixture{
		{err: errors.New("database unavailable")},
		{snapshot: DashboardSnapshot{}},
		{snapshot: DashboardSnapshot{AsOf: time.Now()}},
	} {
		handler, err := NewReserveDashboardHandler(fixture, dashboardSecurityFixture{
			secure: true, allow: true, role: true,
		})
		if err != nil {
			t.Fatal(err)
		}
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/admin/reserves", nil))
		if response.Code != http.StatusServiceUnavailable {
			t.Fatalf("missing source data must return unavailable, got %d", response.Code)
		}
		if strings.Contains(response.Body.String(), "0 UGX") || strings.Contains(response.Body.String(), "0 USD") {
			t.Fatalf("missing data must not render zero reserve values: %s", response.Body.String())
		}
	}
}

func TestDashboardRequiresInjectedSecurityAndReader(t *testing.T) {
	if _, err := NewReserveDashboardHandler(nil, dashboardSecurityFixture{}); !errors.Is(err, ErrDashboardUnavailable) {
		t.Fatalf("missing data source must fail: %v", err)
	}
	if _, err := NewReserveDashboardHandler(&dashboardFixture{}, nil); !errors.Is(err, ErrDashboardUnavailable) {
		t.Fatalf("missing security provider must fail: %v", err)
	}
}
