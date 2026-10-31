package issuer

import (
	"errors"
	"fmt"
)

var ErrInvalidRedemptionTransition = errors.New("invalid redemption state transition")

type RedemptionState string

const (
	RedemptionPending         RedemptionState = "pending"
	RedemptionTokensLocked    RedemptionState = "tokens_locked"
	RedemptionPayoutPending   RedemptionState = "payout_pending"
	RedemptionPayoutConfirmed RedemptionState = "payout_confirmed"
	RedemptionPayoutFailed    RedemptionState = "payout_failed"
	RedemptionTokensReleased  RedemptionState = "tokens_released"
	RedemptionBurned          RedemptionState = "burned"
	RedemptionFailed          RedemptionState = "failed"
)

type RedemptionEvidence interface {
	verifiedRedemptionEvidence()
}

type redemptionEvidence struct {
	treasuryQuorumVerified bool
	chainLockConfirmed     bool
	bankPayoutSubmitted    bool
	bankPayoutConfirmed    bool
	bankPayoutFailed       bool
	bankEventSignatureOK   bool
	chainBurnConfirmed     bool
	chainLockReleased      bool
}

func (redemptionEvidence) verifiedRedemptionEvidence() {}

// AdvanceRedemption enforces lock-before-payout and confirmed-payout-before-burn.
// The caller must persist each state transition and its audit event atomically.
func AdvanceRedemption(current, next RedemptionState, evidence RedemptionEvidence) error {
	proof, ok := evidence.(redemptionEvidence)
	if !ok {
		return fmt.Errorf("%w: verification evidence is missing", ErrInvalidRedemptionTransition)
	}
	valid := false
	switch {
	case current == RedemptionPending && next == RedemptionTokensLocked:
		valid = proof.treasuryQuorumVerified && proof.chainLockConfirmed
	case current == RedemptionTokensLocked && next == RedemptionPayoutPending:
		valid = proof.treasuryQuorumVerified && proof.bankPayoutSubmitted
	case current == RedemptionPayoutPending && next == RedemptionPayoutConfirmed:
		valid = proof.bankPayoutConfirmed && proof.bankEventSignatureOK
	case current == RedemptionPayoutPending && next == RedemptionPayoutFailed:
		valid = proof.bankPayoutFailed && proof.bankEventSignatureOK
	case current == RedemptionPayoutFailed && next == RedemptionTokensReleased:
		valid = proof.treasuryQuorumVerified && proof.chainLockReleased
	case current == RedemptionPayoutConfirmed && next == RedemptionBurned:
		valid = proof.chainBurnConfirmed
	case current == RedemptionPending && next == RedemptionFailed:
		valid = true
	}
	if !valid {
		return fmt.Errorf("%w: %s -> %s", ErrInvalidRedemptionTransition, current, next)
	}
	return nil
}
