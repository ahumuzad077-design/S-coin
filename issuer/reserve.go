package issuer

import (
	"errors"
	"fmt"
	"math/big"
	"strings"
	"time"
)

var (
	ErrInvalidAmount        = errors.New("amount must be a non-negative integer")
	ErrInvalidSnapshot      = errors.New("reserve snapshot is inconsistent")
	ErrCoverageInsufficient = errors.New("eligible reserve does not cover outstanding liabilities")
	ErrReconciliationFailed = errors.New("reserve reconciliation failed")
)

// ReserveSnapshot values are integer strings in currency minor units or whole
// token units. OutstandingTokenUnits includes locked, unburned tokens;
// PendingRedemptionTokenUnits is a subset and remains covered until burned.
// Pending deposits are excluded and pending payouts are reserved against
// confirmed funds until settlement.
type ReserveSnapshot struct {
	AssetCode                   string `json:"asset_code"`
	ConfirmedReserveMinorUnits  string `json:"confirmed_reserve_minor_units"`
	RestrictedReserveMinorUnits string `json:"restricted_reserve_minor_units"`
	ReservedPayoutMinorUnits    string `json:"reserved_payout_minor_units"`
	PendingDepositMinorUnits    string `json:"pending_deposit_minor_units"`
	OutstandingTokenUnits       string `json:"outstanding_token_units"`
	PendingRedemptionTokenUnits string `json:"pending_redemption_token_units"`
	ReconciliationHealthy       bool   `json:"reconciliation_healthy"`
	IssuanceSuspended           bool   `json:"issuance_suspended"`
}

type Coverage struct {
	AvailableReserveMinorUnits  string `json:"available_reserve_minor_units"`
	RestrictedReserveMinorUnits string `json:"restricted_reserve_minor_units"`
	LiabilityMinorUnits         string `json:"liability_minor_units"`
	Percent                     string `json:"coverage_percent"`
	CanIssue                    bool   `json:"can_issue"`
}

func CalculateCoverage(snapshot ReserveSnapshot) (Coverage, error) {
	asset, err := AssetByCode(snapshot.AssetCode)
	if err != nil {
		return Coverage{}, err
	}
	reserve, err := parseAmount(snapshot.ConfirmedReserveMinorUnits)
	if err != nil {
		return Coverage{}, fmt.Errorf("confirmed reserve: %w", err)
	}
	reservedPayouts, err := parseAmount(snapshot.ReservedPayoutMinorUnits)
	if err != nil {
		return Coverage{}, fmt.Errorf("reserved payouts: %w", err)
	}
	restrictedReserve, err := parseAmount(snapshot.RestrictedReserveMinorUnits)
	if err != nil {
		return Coverage{}, fmt.Errorf("restricted reserve: %w", err)
	}
	if _, err := parseAmount(snapshot.PendingDepositMinorUnits); err != nil {
		return Coverage{}, fmt.Errorf("pending deposits: %w", err)
	}
	outstanding, err := parseAmount(snapshot.OutstandingTokenUnits)
	if err != nil {
		return Coverage{}, fmt.Errorf("outstanding tokens: %w", err)
	}
	pendingRedemptions, err := parseAmount(snapshot.PendingRedemptionTokenUnits)
	if err != nil {
		return Coverage{}, fmt.Errorf("pending redemptions: %w", err)
	}

	if pendingRedemptions.Cmp(outstanding) > 0 {
		return Coverage{}, ErrInvalidSnapshot
	}
	liability := new(big.Int).Mul(outstanding, new(big.Int).SetUint64(asset.FiatMinorUnitsPerBaseUnit))
	unavailable := new(big.Int).Add(reservedPayouts, restrictedReserve)
	available := new(big.Int).Sub(reserve, unavailable)
	withinReserve := available.Sign() >= 0
	if available.Sign() < 0 {
		available.SetInt64(0)
	}
	percent := coveragePercent(available, liability)

	return Coverage{
		AvailableReserveMinorUnits:  available.String(),
		RestrictedReserveMinorUnits: restrictedReserve.String(),
		LiabilityMinorUnits:         liability.String(),
		Percent:                     percent,
		CanIssue:                    withinReserve && !snapshot.IssuanceSuspended && snapshot.ReconciliationHealthy && available.Cmp(liability) >= 0,
	}, nil
}

func validateIssuancePolicy(
	snapshot ReserveSnapshot,
	operation TreasuryOperation,
	authorization VerifiedTreasuryAuthorization,
	now time.Time,
) error {
	if snapshot.IssuanceSuspended || !snapshot.ReconciliationHealthy {
		return ErrReconciliationFailed
	}
	asset, err := AssetByCode(snapshot.AssetCode)
	if err != nil {
		return err
	}
	if operation.Action != "mint" || operation.AssetCode != snapshot.AssetCode {
		return ErrInvalidOperation
	}
	amount, err := parseAmount(operation.Amount)
	if err != nil {
		return fmt.Errorf("issuance amount: %w", err)
	}
	if amount.Sign() <= 0 {
		return fmt.Errorf("issuance amount must be positive")
	}
	if !authorization.validFor(operation, now) {
		return ErrInvalidQuorum
	}
	coverage, err := CalculateCoverage(snapshot)
	if err != nil {
		return err
	}
	proposedLiability := new(big.Int).Mul(amount, new(big.Int).SetUint64(asset.FiatMinorUnitsPerBaseUnit))
	eligible := new(big.Int)
	eligible, ok := new(big.Int).SetString(coverage.AvailableReserveMinorUnits, 10)
	if !ok {
		return ErrInvalidAmount
	}
	liabilities := new(big.Int)
	liabilities, ok = new(big.Int).SetString(coverage.LiabilityMinorUnits, 10)
	if !ok {
		return ErrInvalidAmount
	}
	if eligible.Cmp(new(big.Int).Add(liabilities, proposedLiability)) < 0 {
		return ErrCoverageInsufficient
	}
	return nil
}

type ReconciliationInput struct {
	AssetCode                   string
	BankBalanceMinorUnits       string
	LedgerReserveMinorUnits     string
	RestrictedReserveMinorUnits string
	ReservedPayoutMinorUnits    string
	OnChainSupplyTokenUnits     string
	LedgerOutstandingTokenUnits string
	BankConfirmed               bool
	CustodianConfirmed          bool
}

type ReconciliationResult struct {
	Healthy                      bool
	IssuanceSuspended            bool
	ReserveDiscrepancyMinorUnits string
	RestrictedReserveMinorUnits  string
	SupplyDiscrepancyTokenUnits  string
	CoverageShortfallMinorUnits  string
}

func Reconcile(input ReconciliationInput) (ReconciliationResult, error) {
	asset, err := AssetByCode(input.AssetCode)
	if err != nil {
		return ReconciliationResult{}, err
	}
	bank, err := parseAmount(input.BankBalanceMinorUnits)
	if err != nil {
		return ReconciliationResult{}, fmt.Errorf("bank balance: %w", err)
	}
	ledgerReserve, err := parseAmount(input.LedgerReserveMinorUnits)
	if err != nil {
		return ReconciliationResult{}, fmt.Errorf("ledger reserve: %w", err)
	}
	reservedPayouts, err := parseAmount(input.ReservedPayoutMinorUnits)
	if err != nil {
		return ReconciliationResult{}, fmt.Errorf("reserved payouts: %w", err)
	}
	restrictedReserve, err := parseAmount(input.RestrictedReserveMinorUnits)
	if err != nil {
		return ReconciliationResult{}, fmt.Errorf("restricted reserve: %w", err)
	}
	chainSupply, err := parseAmount(input.OnChainSupplyTokenUnits)
	if err != nil {
		return ReconciliationResult{}, fmt.Errorf("on-chain supply: %w", err)
	}
	ledgerLiability, err := parseAmount(input.LedgerOutstandingTokenUnits)
	if err != nil {
		return ReconciliationResult{}, fmt.Errorf("ledger liabilities: %w", err)
	}

	reserveDiff := new(big.Int).Sub(bank, ledgerReserve)
	supplyDiff := new(big.Int).Sub(chainSupply, ledgerLiability)
	unavailableReserve := new(big.Int).Add(reservedPayouts, restrictedReserve)
	availableReserve := new(big.Int).Sub(bank, unavailableReserve)
	unavailableExceedsBank := availableReserve.Sign() < 0
	if availableReserve.Sign() < 0 {
		availableReserve.SetInt64(0)
	}
	liabilityMinorUnits := new(big.Int).Mul(
		ledgerLiability,
		new(big.Int).SetUint64(asset.FiatMinorUnitsPerBaseUnit),
	)
	shortfall := new(big.Int).Sub(liabilityMinorUnits, availableReserve)
	if shortfall.Sign() < 0 {
		shortfall.SetInt64(0)
	}
	healthy := input.BankConfirmed && input.CustodianConfirmed &&
		reserveDiff.Sign() == 0 && supplyDiff.Sign() == 0 &&
		shortfall.Sign() == 0 && !unavailableExceedsBank

	return ReconciliationResult{
		Healthy:                      healthy,
		IssuanceSuspended:            !healthy,
		ReserveDiscrepancyMinorUnits: reserveDiff.String(),
		RestrictedReserveMinorUnits:  restrictedReserve.String(),
		SupplyDiscrepancyTokenUnits:  supplyDiff.String(),
		CoverageShortfallMinorUnits:  shortfall.String(),
	}, nil
}

func parseAmount(value string) (*big.Int, error) {
	if value == "" || len(value) > 78 || strings.TrimSpace(value) != value ||
		strings.HasPrefix(value, "+") || strings.HasPrefix(value, "-") {
		return nil, ErrInvalidAmount
	}
	for _, r := range value {
		if r < '0' || r > '9' {
			return nil, ErrInvalidAmount
		}
	}
	result, ok := new(big.Int).SetString(value, 10)
	if !ok {
		return nil, ErrInvalidAmount
	}
	return result, nil
}

func coveragePercent(reserve, liability *big.Int) string {
	if liability.Sign() == 0 {
		if reserve.Sign() == 0 {
			return "n/a"
		}
		return "unbounded"
	}
	scaled := new(big.Int).Mul(reserve, big.NewInt(10000))
	scaled.Quo(scaled, liability)
	whole := new(big.Int).Quo(scaled, big.NewInt(100))
	fraction := new(big.Int).Mod(scaled, big.NewInt(100))
	return fmt.Sprintf("%s.%02d", whole.String(), fraction.Int64())
}
