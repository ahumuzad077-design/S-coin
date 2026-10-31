package issuer

import (
	"crypto/ed25519"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"testing"
	"time"
)

func TestHMACWebhookVerifierChecksSignatureAndFreshness(t *testing.T) {
	secret := []byte("only-test-fixture-secret-with-32-bytes")
	now := time.Unix(1_800_000_000, 0)
	eventID := "fixture-event"
	timestamp := "1800000000"
	body := []byte(`{"status":"cleared","amount":"test-fixture"}`)
	verifier, err := NewHMACWebhookVerifier(secret, 5*time.Minute)
	if err != nil {
		t.Fatal(err)
	}
	valid := signWebhook(secret, eventID, timestamp, body)
	if err := verifier.Verify(eventID, timestamp, body, valid, now); err != nil {
		t.Fatalf("valid test signature rejected: %v", err)
	}
	if err := verifier.Verify(eventID, timestamp, []byte("tampered"), valid, now); !errors.Is(err, ErrInvalidWebhook) {
		t.Fatalf("tampered payload must be rejected: %v", err)
	}
	if err := verifier.Verify(eventID, timestamp, body, valid, now.Add(6*time.Minute)); !errors.Is(err, ErrInvalidWebhook) {
		t.Fatalf("stale webhook must be rejected: %v", err)
	}
	if _, err := NewHMACWebhookVerifier([]byte("short"), time.Minute); !errors.Is(err, ErrWebhookNotConfigured) {
		t.Fatalf("short secret must leave verification disabled: %v", err)
	}
}

func TestMultisigRequiresDistinctAuthorizedSignersAndBindsEntireOperation(t *testing.T) {
	signers := make([]TreasurySigner, 3)
	privateKeys := make([]ed25519.PrivateKey, 3)
	for i := range signers {
		publicKey, privateKey, err := ed25519.GenerateKey(rand.Reader)
		if err != nil {
			t.Fatal(err)
		}
		privateKeys[i] = privateKey
		signers[i] = TreasurySigner{ID: string(rune('a' + i)), PublicKey: publicKey, Role: "treasury"}
	}
	policy, err := NewMultisigPolicy(2, signers)
	if err != nil {
		t.Fatal(err)
	}
	now := time.Unix(1_800_000_000, 0)
	operation := TreasuryOperation{
		ID: "fixture-operation", Action: "mint", AssetCode: "SQM-UGX",
		Amount: "1", Recipient: "fixture-recipient", ChainID: "fixture-chain",
		ExpiresAtUnix: now.Add(time.Minute).Unix(),
	}
	approval := func(index int, op TreasuryOperation) TreasuryApproval {
		signature, err := SignOperation(privateKeys[index], op)
		if err != nil {
			t.Fatal(err)
		}
		return TreasuryApproval{SignerID: signers[index].ID, Signature: signature}
	}
	first := approval(0, operation)
	second := approval(1, operation)
	if err := policy.Verify(operation, []TreasuryApproval{first, second}, now); err != nil {
		t.Fatalf("valid 2-of-3 quorum rejected: %v", err)
	}
	if err := policy.Verify(operation, []TreasuryApproval{first, first}, now); !errors.Is(err, ErrInvalidQuorum) {
		t.Fatalf("duplicate signer must not satisfy quorum: %v", err)
	}
	tampered := operation
	tampered.Amount = "2"
	if err := policy.Verify(tampered, []TreasuryApproval{first, second}, now); !errors.Is(err, ErrInvalidQuorum) {
		t.Fatalf("approvals must bind exact amount: %v", err)
	}
	if err := policy.Verify(operation, []TreasuryApproval{first}, now); !errors.Is(err, ErrInvalidQuorum) {
		t.Fatalf("single signer must not satisfy 2-of-3 quorum: %v", err)
	}
	for _, invalidAmount := range []string{"0", "00", "01"} {
		invalid := operation
		invalid.Amount = invalidAmount
		if err := policy.Verify(invalid, []TreasuryApproval{first, second}, now); !errors.Is(err, ErrInvalidOperation) {
			t.Errorf("noncanonical or zero operation amount %q must be rejected: %v", invalidAmount, err)
		}
		if _, err := SignOperation(privateKeys[0], invalid); !errors.Is(err, ErrInvalidOperation) {
			t.Errorf("invalid amount %q must not be signed: %v", invalidAmount, err)
		}
	}
	if _, err := NewMultisigPolicy(1, signers); !errors.Is(err, ErrInvalidQuorum) {
		t.Fatalf("single-signature treasury policy must be rejected: %v", err)
	}
}

func TestMultisigRevokedSignerCannotAuthorizeNewOperation(t *testing.T) {
	now := time.Unix(1_800_000_000, 0)
	publicKeys := make([]ed25519.PublicKey, 2)
	privateKeys := make([]ed25519.PrivateKey, 2)
	allSigners := make([]TreasurySigner, 2)
	for i := range allSigners {
		publicKey, privateKey, err := ed25519.GenerateKey(rand.Reader)
		if err != nil {
			t.Fatal(err)
		}
		publicKeys[i], privateKeys[i] = publicKey, privateKey
		allSigners[i] = TreasurySigner{ID: string(rune('r' + i)), PublicKey: publicKey, Role: "treasury"}
	}
	operation := TreasuryOperation{
		ID: "fixture-revocation", Action: "mint", AssetCode: "SQM-UGX",
		Amount: "1", Recipient: "fixture-recipient", ChainID: "fixture-chain",
		ExpiresAtUnix: now.Add(time.Minute).Unix(),
	}
	signature, err := SignOperation(privateKeys[0], operation)
	if err != nil {
		t.Fatal(err)
	}
	rotatedPublicKey, _, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	replacement := append([]TreasurySigner(nil), allSigners...)
	replacement[0].PublicKey = rotatedPublicKey
	policy, err := NewMultisigPolicy(2, replacement)
	if err != nil {
		t.Fatal(err)
	}
	secondSignature, err := SignOperation(privateKeys[1], operation)
	if err != nil {
		t.Fatal(err)
	}
	if err := policy.Verify(operation, []TreasuryApproval{
		{SignerID: allSigners[0].ID, Signature: signature},
		{SignerID: allSigners[1].ID, Signature: secondSignature},
	}, now); !errors.Is(err, ErrInvalidQuorum) {
		t.Fatalf("revoked signer approval must not satisfy quorum: %v", err)
	}
}

func fixtureAuthorization(
	t *testing.T,
	assetCode,
	amount string,
	now time.Time,
) (TreasuryOperation, VerifiedTreasuryAuthorization) {
	t.Helper()
	signers := make([]TreasurySigner, 2)
	privateKeys := make([]ed25519.PrivateKey, 2)
	for i := range signers {
		publicKey, privateKey, err := ed25519.GenerateKey(rand.Reader)
		if err != nil {
			t.Fatal(err)
		}
		privateKeys[i] = privateKey
		signers[i] = TreasurySigner{ID: string(rune('p' + i)), PublicKey: publicKey, Role: "treasury"}
	}
	policy, err := NewMultisigPolicy(2, signers)
	if err != nil {
		t.Fatal(err)
	}
	operation := TreasuryOperation{
		ID: "fixture-authorization", Action: "mint", AssetCode: assetCode,
		Amount: amount, Recipient: "fixture-recipient", ChainID: "fixture-chain",
		ExpiresAtUnix: now.Add(time.Minute).Unix(),
	}
	approvals := make([]TreasuryApproval, len(signers))
	for i := range signers {
		signature, err := SignOperation(privateKeys[i], operation)
		if err != nil {
			t.Fatal(err)
		}
		approvals[i] = TreasuryApproval{SignerID: signers[i].ID, Signature: signature}
	}
	authorization, err := policy.Authorize(operation, approvals, now)
	if err != nil {
		t.Fatal(err)
	}
	return operation, authorization
}

func TestIssuanceAuthorizationBindsRecipientChainAndExpiry(t *testing.T) {
	now := time.Unix(1_800_000_000, 0)
	operation, authorization := fixtureAuthorization(t, "SQM-USD", "1", now)
	snapshot := ReserveSnapshot{
		AssetCode: "SQM-USD", ConfirmedReserveMinorUnits: "100",
		RestrictedReserveMinorUnits: "0",
		PendingDepositMinorUnits:    "0",
		ReservedPayoutMinorUnits:    "0", OutstandingTokenUnits: "0",
		PendingRedemptionTokenUnits: "0",
		ReconciliationHealthy:       true,
	}
	if err := validateIssuancePolicy(snapshot, operation, authorization, now); err != nil {
		t.Fatalf("valid exact operation authorization rejected: %v", err)
	}
	for _, mutate := range []func(*TreasuryOperation){
		func(op *TreasuryOperation) { op.Recipient = "different-recipient" },
		func(op *TreasuryOperation) { op.ChainID = "different-chain" },
		func(op *TreasuryOperation) { op.ID = "different-operation" },
		func(op *TreasuryOperation) { op.ExpiresAtUnix++ },
	} {
		tampered := operation
		mutate(&tampered)
		if err := validateIssuancePolicy(snapshot, tampered, authorization, now); !errors.Is(err, ErrInvalidQuorum) {
			t.Errorf("authorization must bind all operation fields, got %v", err)
		}
	}
	if err := validateIssuancePolicy(snapshot, operation, authorization, now.Add(2*time.Minute)); !errors.Is(err, ErrInvalidQuorum) {
		t.Fatalf("expired authorization must be rejected: %v", err)
	}
}

func TestMultisigRejectsExpiredAndWrongRoleApprovals(t *testing.T) {
	now := time.Unix(1_800_000_000, 0)
	privateKeys := make([]ed25519.PrivateKey, 2)
	signers := make([]TreasurySigner, 2)
	for i := range signers {
		publicKey, privateKey, err := ed25519.GenerateKey(rand.Reader)
		if err != nil {
			t.Fatal(err)
		}
		privateKeys[i] = privateKey
		signers[i] = TreasurySigner{ID: string(rune('x' + i)), PublicKey: publicKey, Role: "treasury"}
	}
	policy, err := NewMultisigPolicy(2, signers)
	if err != nil {
		t.Fatal(err)
	}
	operation := TreasuryOperation{
		ID: "op", Action: "payout", AssetCode: "SQM-USD", Amount: "5",
		Recipient: "bank-beneficiary", ChainID: "chain", ExpiresAtUnix: now.Unix() - 1,
	}
	signature, err := SignOperation(privateKeys[0], operation)
	if err != nil {
		t.Fatal(err)
	}
	if err := policy.Verify(operation, []TreasuryApproval{
		{SignerID: signers[0].ID, Signature: signature},
	}, now); !errors.Is(err, ErrInvalidOperation) {
		t.Fatalf("expired operation must fail: %v", err)
	}

	operation.ExpiresAtUnix = now.Add(time.Minute).Unix()
	forged := TreasuryApproval{SignerID: "unknown", Signature: make([]byte, ed25519.SignatureSize)}
	if err := policy.Verify(operation, []TreasuryApproval{forged}, now); !errors.Is(err, ErrInvalidQuorum) {
		t.Fatalf("unknown admin must fail: %v", err)
	}
}

func signWebhook(secret []byte, eventID, timestamp string, body []byte) string {
	mac := hmac.New(sha256.New, secret)
	_, _ = mac.Write([]byte(timestamp + "." + eventID + "."))
	_, _ = mac.Write(body)
	return hex.EncodeToString(mac.Sum(nil))
}
