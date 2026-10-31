package issuer

import (
	"errors"
	"testing"
)

func TestRedemptionRequiresQuorumLockPayoutConfirmationThenBurn(t *testing.T) {
	if err := CanRedeem(); !errors.Is(err, ErrProductionDisabled) {
		t.Fatalf("production redemption must remain disabled: %v", err)
	}
	if err := AdvanceRedemption(RedemptionPending, RedemptionTokensLocked, nil); !errors.Is(err, ErrInvalidRedemptionTransition) {
		t.Fatalf("caller-constructed evidence must fail closed: %v", err)
	}
	if err := AdvanceRedemption(RedemptionPending, RedemptionTokensLocked, redemptionEvidence{
		chainLockConfirmed: true,
	}); !errors.Is(err, ErrInvalidRedemptionTransition) {
		t.Fatalf("lock without treasury quorum must fail: %v", err)
	}
	if err := AdvanceRedemption(RedemptionPending, RedemptionTokensLocked, redemptionEvidence{
		treasuryQuorumVerified: true, chainLockConfirmed: true,
	}); err != nil {
		t.Fatal(err)
	}
	if err := AdvanceRedemption(RedemptionTokensLocked, RedemptionPayoutPending, redemptionEvidence{
		treasuryQuorumVerified: true, bankPayoutSubmitted: true,
	}); err != nil {
		t.Fatal(err)
	}
	if err := AdvanceRedemption(RedemptionPayoutPending, RedemptionPayoutConfirmed, redemptionEvidence{
		bankPayoutConfirmed: true,
	}); !errors.Is(err, ErrInvalidRedemptionTransition) {
		t.Fatalf("unsigned bank confirmation must fail: %v", err)
	}
	if err := AdvanceRedemption(RedemptionPayoutPending, RedemptionPayoutFailed, redemptionEvidence{
		bankPayoutFailed: true,
	}); !errors.Is(err, ErrInvalidRedemptionTransition) {
		t.Fatalf("unsigned payout failure must not unlock tokens: %v", err)
	}
	if err := AdvanceRedemption(RedemptionPayoutPending, RedemptionPayoutFailed, redemptionEvidence{
		bankPayoutFailed: true, bankEventSignatureOK: true,
	}); err != nil {
		t.Fatal(err)
	}
	if err := AdvanceRedemption(RedemptionPayoutFailed, RedemptionTokensReleased, redemptionEvidence{
		chainLockReleased: true,
	}); !errors.Is(err, ErrInvalidRedemptionTransition) {
		t.Fatalf("failed payout requires quorum before releasing the token lock: %v", err)
	}
	if err := AdvanceRedemption(RedemptionPayoutFailed, RedemptionTokensReleased, redemptionEvidence{
		treasuryQuorumVerified: true, chainLockReleased: true,
	}); err != nil {
		t.Fatal(err)
	}
	if err := AdvanceRedemption(RedemptionPayoutPending, RedemptionPayoutConfirmed, redemptionEvidence{
		bankPayoutConfirmed: true, bankEventSignatureOK: true,
	}); err != nil {
		t.Fatal(err)
	}
	if err := AdvanceRedemption(RedemptionPayoutConfirmed, RedemptionBurned, redemptionEvidence{
		chainBurnConfirmed: true,
	}); err != nil {
		t.Fatal(err)
	}
	if err := AdvanceRedemption(RedemptionBurned, RedemptionFailed, redemptionEvidence{}); !errors.Is(err, ErrInvalidRedemptionTransition) {
		t.Fatalf("burned redemption must be terminal: %v", err)
	}
}
