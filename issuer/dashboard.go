package issuer

import (
	"context"
	"errors"
	"html/template"
	"net/http"
	"time"
)

var ErrDashboardUnavailable = errors.New("reserve dashboard data is unavailable")

type DashboardAsset struct {
	AssetCode                   string `json:"asset_code"`
	FiatCurrency                string `json:"fiat_currency"`
	ConfirmedReserveMinorUnits  string `json:"confirmed_reserve_minor_units"`
	RestrictedReserveMinorUnits string `json:"restricted_reserve_minor_units"`
	ReservedPayoutMinorUnits    string `json:"reserved_payout_minor_units"`
	EligibleReserveMinorUnits   string `json:"eligible_reserve_minor_units"`
	PendingDepositMinorUnits    string `json:"pending_deposit_minor_units"`
	PendingDepositCount         uint64 `json:"pending_deposit_count"`
	CompletedDepositCount       uint64 `json:"completed_deposit_count"`
	IssuedTokenUnits            string `json:"issued_token_units"`
	OutstandingLiabilityMinor   string `json:"outstanding_liability_minor_units"`
	CoveragePercent             string `json:"coverage_percent"`
	PendingRedemptionTokenUnits string `json:"pending_redemption_token_units"`
	CompletedPayoutMinorUnits   string `json:"completed_payout_minor_units"`
	ReconciliationStatus        string `json:"reconciliation_status"`
	IssuanceSuspended           bool   `json:"issuance_suspended"`
}

type DashboardAuditEntry struct {
	OccurredAt time.Time `json:"occurred_at"`
	Actor      string    `json:"actor"`
	Action     string    `json:"action"`
	AssetCode  string    `json:"asset_code"`
	ObjectID   string    `json:"object_id"`
}

type DashboardSnapshot struct {
	AsOf         time.Time             `json:"as_of"`
	Assets       []DashboardAsset      `json:"assets"`
	AuditHistory []DashboardAuditEntry `json:"audit_history"`
}

type DashboardReader interface {
	ReadReserveDashboard(context.Context) (DashboardSnapshot, error)
}

// DashboardSecurity must use an approved strong-authentication provider,
// verified TLS/proxy configuration, RBAC, and a production rate limiter.
type DashboardSecurity interface {
	IsSecureTransport(*http.Request) bool
	AllowRequest(*http.Request) bool
	HasRole(*http.Request, string) bool
}

var dashboardTemplate = template.Must(template.New("reserve-dashboard").Parse(`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>SQM reserve administration</title>
<style>
body{font:16px system-ui,sans-serif;background:#0b1010;color:#e8eee8;margin:2rem}
main{max-width:1100px;margin:auto}h1{color:#b4f36b}.warning{border:1px solid #e6ad58;padding:1rem}
table{width:100%;border-collapse:collapse;margin:1.5rem 0}th,td{text-align:left;padding:.8rem;border-bottom:1px solid #34413b}
code{overflow-wrap:anywhere}.status{font-weight:700}
</style>
</head>
<body><main>
<h1>SQM reserve administration</h1>
<p class="warning">Administrative data. Only bank- and custodian-confirmed funds are eligible reserve assets. Pending deposits are not backing. This page does not itself authorize minting or payouts.</p>
<p>Snapshot time: {{.AsOf.UTC.Format "2006-01-02 15:04:05 UTC"}} · Production issuance: DISABLED (production integrations are not configured)</p>
<table>
<thead><tr><th>Asset</th><th>Confirmed reserve</th><th>Pending deposits</th><th>Issued</th><th>Liabilities</th><th>Coverage</th><th>Pending redemptions</th><th>Reconciliation</th><th>Issuance</th></tr></thead>
<tbody>{{range .Assets}}
<tr>
<td>{{.AssetCode}} ({{.FiatCurrency}})</td>
<td>{{.ConfirmedReserveMinorUnits}} {{.FiatCurrency}} minor units<br>Restricted: {{.RestrictedReserveMinorUnits}} {{.FiatCurrency}} minor units<br>Eligible: {{.EligibleReserveMinorUnits}} {{.FiatCurrency}} minor units</td>
<td>{{.PendingDepositMinorUnits}} {{.FiatCurrency}} minor units · {{.PendingDepositCount}} awaiting verification</td>
<td>{{.IssuedTokenUnits}} tokens</td>
<td>{{.OutstandingLiabilityMinor}} {{.FiatCurrency}} minor units</td>
<td>{{if or (eq .CoveragePercent "unbounded") (eq .CoveragePercent "n/a")}}{{.CoveragePercent}}{{else}}{{.CoveragePercent}}%{{end}}</td>
<td>{{.PendingRedemptionTokenUnits}} tokens</td>
<td>{{.ReconciliationStatus}}</td>
<td class="status">DISABLED</td>
</tr>{{end}}</tbody>
</table>
<h2>Completed deposits</h2>
{{range .Assets}}<p>{{.AssetCode}}: {{.CompletedDepositCount}} bank-confirmed deposits</p>{{end}}
<h2>Completed payouts</h2>
{{range .Assets}}<p>{{.AssetCode}}: {{.CompletedPayoutMinorUnits}} {{.FiatCurrency}} minor units</p>{{end}}
<h2>Audit history</h2>
<table><thead><tr><th>Time</th><th>Actor</th><th>Action</th><th>Asset</th><th>Record</th></tr></thead><tbody>
{{range .AuditHistory}}<tr><td>{{.OccurredAt.UTC.Format "2006-01-02 15:04:05 UTC"}}</td><td>{{.Actor}}</td><td>{{.Action}}</td><td>{{.AssetCode}}</td><td><code>{{.ObjectID}}</code></td></tr>{{end}}
</tbody></table>
</main></body></html>`))

func NewReserveDashboardHandler(reader DashboardReader, security DashboardSecurity) (http.Handler, error) {
	if reader == nil || security == nil {
		return nil, ErrDashboardUnavailable
	}
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("X-Frame-Options", "DENY")
		w.Header().Set("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'")
		if r.URL.Path != "/admin/reserves" {
			http.NotFound(w, r)
			return
		}
		if r.Method != http.MethodGet {
			w.Header().Set("Allow", http.MethodGet)
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		if !security.IsSecureTransport(r) {
			http.Error(w, "secure transport required", http.StatusForbidden)
			return
		}
		if !security.AllowRequest(r) {
			http.Error(w, "rate limit exceeded", http.StatusTooManyRequests)
			return
		}
		if !security.HasRole(r, "reserve_reader") {
			http.Error(w, "authentication and reserve_reader role required", http.StatusUnauthorized)
			return
		}
		snapshot, err := reader.ReadReserveDashboard(r.Context())
		if err != nil {
			http.Error(w, "verified reserve data unavailable", http.StatusServiceUnavailable)
			return
		}
		if snapshot.AsOf.IsZero() || len(snapshot.Assets) == 0 {
			http.Error(w, "verified reserve data unavailable", http.StatusServiceUnavailable)
			return
		}
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		if err := dashboardTemplate.Execute(w, snapshot); err != nil {
			return
		}
	}), nil
}
