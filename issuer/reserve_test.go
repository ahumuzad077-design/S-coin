package issuer

import (
	"errors"
	"strings"
	"testing"
	"time"
)

func TestCoverageExcludesPendingDepositsAndKeepsLockedTokensAsLiabilities(t *testing.T) {
	snapshot := ReserveSnapshot{
		AssetCode:                   "SQM-USD",
		ConfirmedReserveMinorUnits:  "12000",
		RestrictedReserveMinorUnits: "1000",
		ReservedPayoutMinorUnits:    "2000",
		PendingDepositMinorUnits:    "50000",
		OutstandingTokenUnits:       "9000",
		PendingRedemptionTokenUnits: "2000",
		ReconciliationHealthy:       true,
	}
	coverage, err := CalculateCoverage(snapshot)
	if err != nil {
		t.Fatal(err)
	}
	if coverage.AvailableReserveMinorUnits != "9000" || coverage.LiabilityMinorUnits != "9000" || coverage.Percent != "100.00" || !coverage.CanIssue {
		t.Fatalf("restricted and pending funds must be excluded while locked tokens remain covered: %+v", coverage)
	}
}

func TestIssuancePolicyRequiresQuorumAndFullPostIssueCoverage(t *testing.T) {
	snapshot := ReserveSnapshot{
		AssetCode:                   "SQM-UGX",
		ConfirmedReserveMinorUnits:  "1000",
		RestrictedReserveMinorUnits: "0",
		ReservedPayoutMinorUnits:    "0",
		PendingDepositMinorUnits:    "100000",
		OutstandingTokenUnits:       "900",
		PendingRedemptionTokenUnits: "0",
		ReconciliationHealthy:       true,
	}
	now := time.Unix(1_800_000_000, 0)
	operation101, auth101 := fixtureAuthorization(t, "SQM-UGX", "101", now)
	if err := CanIssue(); !errors.Is(err, ErrProductionDisabled) {
		t.Fatalf("unapproved production must fail closed, got %v", err)
	}

	if err := validateIssuancePolicy(snapshot, operation101, auth101, now); !errors.Is(err, ErrCoverageInsufficient) {
		t.Fatalf("issuance exceeding confirmed reserve must fail: %v", err)
	}
	operation100, auth100 := fixtureAuthorization(t, "SQM-UGX", "100", now)
	if err := validateIssuancePolicy(snapshot, operation100, auth100, now); err != nil {
		t.Fatalf("fully covered issuance should pass the pure policy check: %v", err)
	}
	if err := validateIssuancePolicy(snapshot, operation100, auth101, now); !errors.Is(err, ErrInvalidQuorum) {
		t.Fatalf("authorization for a different operation must fail: %v", err)
	}
}

func TestCanIssueSuspendsOnFailedReconciliationOrExplicitSuspension(t *testing.T) {
	now := time.Unix(1_800_000_000, 0)
	operation, authorization := fixtureAuthorization(t, "SQM-UGX", "1", now)
	for _, snapshot := range []ReserveSnapshot{
		{AssetCode: "SQM-UGX", ConfirmedReserveMinorUnits: "1000", RestrictedReserveMinorUnits: "0", ReservedPayoutMinorUnits: "0", PendingDepositMinorUnits: "0", OutstandingTokenUnits: "1", IssuanceSuspended: true, ReconciliationHealthy: true},
		{AssetCode: "SQM-UGX", ConfirmedReserveMinorUnits: "1000", RestrictedReserveMinorUnits: "0", ReservedPayoutMinorUnits: "0", PendingDepositMinorUnits: "0", OutstandingTokenUnits: "1", ReconciliationHealthy: false},
	} {
		if err := validateIssuancePolicy(snapshot, operation, authorization, now); !errors.Is(err, ErrReconciliationFailed) {
			t.Fatalf("issuance must stop when reconciliation is unhealthy: %v", err)
		}
	}
}

func TestReconciliationRequiresBankAndCustodianConfirmationAndExactMatch(t *testing.T) {
	base := ReconciliationInput{
		AssetCode: "SQM-USD", BankBalanceMinorUnits: "10000",
		LedgerReserveMinorUnits: "10000", RestrictedReserveMinorUnits: "0",
		ReservedPayoutMinorUnits:    "0",
		OnChainSupplyTokenUnits:     "10000",
		LedgerOutstandingTokenUnits: "10000", BankConfirmed: true, CustodianConfirmed: true,
	}
	result, err := Reconcile(base)
	if err != nil {
		t.Fatal(err)
	}
	if !result.Healthy || result.IssuanceSuspended {
		t.Fatalf("matching verified books should reconcile: %+v", result)
	}

	base.RestrictedReserveMinorUnits = "1"
	result, err = Reconcile(base)
	if err != nil {
		t.Fatal(err)
	}
	if result.Healthy || result.CoverageShortfallMinorUnits != "1" || !result.IssuanceSuspended {
		t.Fatalf("restricted cash must not count as eligible reserve: %+v", result)
	}

	base.RestrictedReserveMinorUnits = "0"
	base.BankConfirmed = false
	result, err = Reconcile(base)
	if err != nil {
		t.Fatal(err)
	}
	if result.Healthy || !result.IssuanceSuspended {
		t.Fatalf("unconfirmed bank balance must suspend issuance: %+v", result)
	}

	base.BankConfirmed = true
	base.OnChainSupplyTokenUnits = "10001"
	result, err = Reconcile(base)
	if err != nil {
		t.Fatal(err)
	}
	if result.Healthy || result.SupplyDiscrepancyTokenUnits != "1" || !result.IssuanceSuspended {
		t.Fatalf("supply mismatch must suspend issuance: %+v", result)
	}

	base.OnChainSupplyTokenUnits = "10000"
	base.ReservedPayoutMinorUnits = "1"
	result, err = Reconcile(base)
	if err != nil {
		t.Fatal(err)
	}
	if result.Healthy || result.CoverageShortfallMinorUnits != "1" || !result.IssuanceSuspended {
		t.Fatalf("payout reservations that break coverage must suspend issuance: %+v", result)
	}
}

func TestCoverageRejectsMalformedAmounts(t *testing.T) {
	for _, amount := range []string{"", "-1", "+1", "1.0", " 1", "1e2", strings.Repeat("9", 79)} {
		_, err := CalculateCoverage(ReserveSnapshot{
			AssetCode: "SQM-UGX", ConfirmedReserveMinorUnits: amount,
			RestrictedReserveMinorUnits: "0",
			ReservedPayoutMinorUnits:    "0", PendingDepositMinorUnits: "0",
			OutstandingTokenUnits: "0", ReconciliationHealthy: true,
		})
		if !errors.Is(err, ErrInvalidAmount) {
			t.Errorf("amount %q should be rejected, got %v", amount, err)
		}
	}
	_, err := CalculateCoverage(ReserveSnapshot{
		AssetCode: "SQM-UGX", ConfirmedReserveMinorUnits: "100",
		RestrictedReserveMinorUnits: "0",
		ReservedPayoutMinorUnits:    "0", PendingDepositMinorUnits: "invalid",
		OutstandingTokenUnits: "0", PendingRedemptionTokenUnits: "0",
	})
	if !errors.Is(err, ErrInvalidAmount) {
		t.Fatalf("malformed pending amount must not be ignored: %v", err)
	}
}

func TestCoverageRejectsPendingRedemptionsGreaterThanOutstandingSupply(t *testing.T) {
	_, err := CalculateCoverage(ReserveSnapshot{
		AssetCode: "SQM-UGX", ConfirmedReserveMinorUnits: "100",
		RestrictedReserveMinorUnits: "0", ReservedPayoutMinorUnits: "0", OutstandingTokenUnits: "2",
		PendingDepositMinorUnits: "0", PendingRedemptionTokenUnits: "3",
	})
	if !errors.Is(err, ErrInvalidSnapshot) {
		t.Fatalf("inconsistent liability snapshot must fail: %v", err)
	}
}
