package issuer

import (
	"errors"
	"fmt"
	"testing"
	"time"
)

func TestVerifiedDepositRequiresSignedClearedEventAndPreservesCurrencyUnits(t *testing.T) {
	secret := []byte("only-test-fixture-secret-with-32-bytes")
	now := time.Unix(1_800_000_000, 0)
	eventID := "fixture-deposit-event"
	timestamp := fmt.Sprint(now.Unix())
	body := []byte(`{"event_type":"deposit","transaction_reference":"fixture-bank-reference","currency":"USD","amount_minor_units":"1250","status":"cleared"}`)
	verifier, err := NewHMACWebhookVerifier(secret, time.Minute)
	if err != nil {
		t.Fatal(err)
	}
	signature := signWebhook(secret, eventID, timestamp, body)
	deposit, err := VerifyDepositWebhook(verifier, eventID, timestamp, signature, body, now)
	if err != nil {
		t.Fatal(err)
	}
	if err := deposit.Validate(); err != nil {
		t.Fatal(err)
	}
	if deposit.AssetCode() != "SQM-USD" || deposit.AmountMinorUnits() != "1250" {
		t.Fatalf("wrong verified fixture values: %+v", deposit)
	}
	tokens, remainder, err := deposit.WholeTokenUnits()
	if err != nil {
		t.Fatal(err)
	}
	if tokens != "12" || remainder != "50" {
		t.Fatalf("whole-dollar and sub-dollar units mismatch: tokens=%s remainder=%s", tokens, remainder)
	}
	baseUnits, err := deposit.BaseTokenUnits()
	if err != nil {
		t.Fatal(err)
	}
	if baseUnits != "1250" {
		t.Fatalf("USD 12.50 should map to 1250 sqmusd base units, got %s", baseUnits)
	}
}

func TestUGXWholeCurrencyUnitsMapOneToOneToSQMUGX(t *testing.T) {
	secret := []byte("only-test-fixture-secret-with-32-bytes")
	now := time.Unix(1_800_000_000, 0)
	eventID := "fixture-ugx-deposit"
	timestamp := fmt.Sprint(now.Unix())
	body := []byte(`{"event_type":"deposit","transaction_reference":"fixture-ugx-ref","currency":"UGX","amount_minor_units":"25","status":"cleared"}`)
	verifier, err := NewHMACWebhookVerifier(secret, time.Minute)
	if err != nil {
		t.Fatal(err)
	}
	deposit, err := VerifyDepositWebhook(
		verifier, eventID, timestamp,
		signWebhook(secret, eventID, timestamp, body), body, now,
	)
	if err != nil {
		t.Fatal(err)
	}
	baseUnits, err := deposit.BaseTokenUnits()
	if err != nil {
		t.Fatal(err)
	}
	wholeTokens, remainder, err := deposit.WholeTokenUnits()
	if err != nil {
		t.Fatal(err)
	}
	if baseUnits != "25" || wholeTokens != "25" || remainder != "0" {
		t.Fatalf("UGX 25 must map to 25 sqmugx units: base=%s whole=%s remainder=%s", baseUnits, wholeTokens, remainder)
	}
}

func TestPendingOrMalformedWebhookCannotBecomeVerifiedDeposit(t *testing.T) {
	secret := []byte("only-test-fixture-secret-with-32-bytes")
	now := time.Unix(1_800_000_000, 0)
	timestamp := fmt.Sprint(now.Unix())
	verifier, err := NewHMACWebhookVerifier(secret, time.Minute)
	if err != nil {
		t.Fatal(err)
	}
	for _, body := range [][]byte{
		[]byte(`{"event_type":"deposit","transaction_reference":"ref","currency":"UGX","amount_minor_units":"1","status":"pending"}`),
		[]byte(`{"event_type":"deposit","transaction_reference":"ref","currency":"EUR","amount_minor_units":"1","status":"cleared"}`),
		[]byte(`{"event_type":"deposit","transaction_reference":"ref","currency":"UGX","amount_minor_units":"1","status":"cleared"} {}`),
		[]byte(`{"event_type":"payout","transaction_reference":"ref","currency":"UGX","amount_minor_units":"1","status":"cleared"}`),
	} {
		signature := signWebhook(secret, "fixture-event", timestamp, body)
		if _, err := VerifyDepositWebhook(verifier, "fixture-event", timestamp, signature, body, now); !errors.Is(err, ErrInvalidWebhook) {
			t.Errorf("unconfirmed or malformed fixture must be rejected, got %v", err)
		}
	}
	if _, err := VerifyDepositWebhook(nil, "fixture-event", timestamp, "sig", []byte("{}"), now); !errors.Is(err, ErrWebhookNotConfigured) {
		t.Fatalf("missing production verifier must fail closed: %v", err)
	}
}

func TestPayoutRequiresSeparatelySignedSettledEvent(t *testing.T) {
	secret := []byte("only-test-fixture-secret-with-32-bytes")
	now := time.Unix(1_800_000_000, 0)
	timestamp := fmt.Sprint(now.Unix())
	body := []byte(`{"event_type":"payout","transaction_reference":"fixture-payout-ref","currency":"UGX","amount_minor_units":"25","status":"settled"}`)
	verifier, err := NewHMACWebhookVerifier(secret, time.Minute)
	if err != nil {
		t.Fatal(err)
	}
	payout, err := VerifyPayoutWebhook(verifier, "fixture-payout", timestamp, signWebhook(secret, "fixture-payout", timestamp, body), body, now)
	if err != nil {
		t.Fatal(err)
	}
	if err := payout.Validate(); err != nil {
		t.Fatal(err)
	}
	if payout.AssetCode() != "SQM-UGX" || payout.AmountMinorUnits() != "25" {
		t.Fatalf("wrong payout fixture values: %+v", payout)
	}

	pending := []byte(`{"event_type":"payout","transaction_reference":"ref","currency":"UGX","amount_minor_units":"25","status":"pending"}`)
	if _, err := VerifyPayoutWebhook(verifier, "pending-payout", timestamp, signWebhook(secret, "pending-payout", timestamp, pending), pending, now); !errors.Is(err, ErrInvalidWebhook) {
		t.Fatalf("pending bank payout must not be treated as settled: %v", err)
	}
}
