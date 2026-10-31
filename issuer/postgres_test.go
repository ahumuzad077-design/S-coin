package issuer

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"os"
	"testing"
	"time"
)

func TestValidatePostgresURL(t *testing.T) {
	tests := []struct {
		name string
		url  string
		ok   bool
	}{
		{name: "verified PostgreSQL URL", url: "postgresql://issuer@db.example/issuer?sslmode=verify-full", ok: true},
		{name: "non-PostgreSQL scheme", url: "https://db.example/issuer?sslmode=verify-full"},
		{name: "TLS verification disabled", url: "postgresql://issuer@db.example/issuer?sslmode=require"},
		{name: "duplicate TLS mode", url: "postgresql://issuer@db.example/issuer?sslmode=verify-full&sslmode=disable"},
		{name: "missing host", url: "postgresql:///issuer?sslmode=verify-full"},
		{name: "missing database", url: "postgresql://db.example?sslmode=verify-full"},
		{name: "invalid URL", url: "not a URL"},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			err := validatePostgresURL(test.url)
			if test.ok && err != nil {
				t.Fatalf("expected valid URL, got %v", err)
			}
			if !test.ok && !errors.Is(err, ErrInvalidDatabaseURL) {
				t.Fatalf("expected ErrInvalidDatabaseURL, got %v", err)
			}
		})
	}
}

func TestBankDepositNeedsMatchingIndependentConfirmation(t *testing.T) {
	secret := []byte("only-test-fixture-secret-with-32-bytes")
	now := time.Now().UTC()
	eventID := "fixture-deposit-event"
	timestamp := fmt.Sprint(now.Unix())
	body := []byte(`{"event_type":"deposit","transaction_reference":"fixture-bank-reference","currency":"USD","amount_minor_units":"1250","status":"cleared"}`)
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

	valid := BankTransaction{
		PartnerID:          "approved-bank",
		AccountID:          "00000000-0000-4000-8000-000000000001",
		TransactionRef:     deposit.TransactionRef(),
		EventType:          "deposit",
		AssetCode:          deposit.AssetCode(),
		AmountMinorUnits:   deposit.AmountMinorUnits(),
		Status:             "confirmed",
		EvidenceSHA256:     "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
		ProviderOccurredAt: now,
	}
	if err := validateBankDepositConfirmation(valid.AccountID, valid.PartnerID, deposit, valid); err != nil {
		t.Fatalf("matching independent confirmation rejected: %v", err)
	}

	tampered := []BankTransaction{valid, valid, valid, valid}
	tampered[0].AmountMinorUnits = "1251"
	tampered[1].Status = "pending"
	tampered[2].AccountID = "00000000-0000-4000-8000-000000000002"
	tampered[3].EvidenceSHA256 = "not-a-sha256"
	for _, confirmation := range tampered {
		if err := validateBankDepositConfirmation(valid.AccountID, valid.PartnerID, deposit, confirmation); !errors.Is(err, ErrBankConfirmationMismatch) {
			t.Fatalf("mismatched confirmation unexpectedly accepted: %+v", confirmation)
		}
	}
}

func TestBankPayoutNeedsMatchingIndependentConfirmation(t *testing.T) {
	secret := []byte("only-test-fixture-secret-with-32-bytes")
	now := time.Now().UTC()
	eventID := "fixture-payout-event"
	timestamp := fmt.Sprint(now.Unix())
	body := []byte(`{"event_type":"payout","transaction_reference":"fixture-payout-reference","currency":"UGX","amount_minor_units":"2500","status":"settled"}`)
	verifier, err := NewHMACWebhookVerifier(secret, time.Minute)
	if err != nil {
		t.Fatal(err)
	}
	payout, err := VerifyPayoutWebhook(
		verifier, eventID, timestamp,
		signWebhook(secret, eventID, timestamp, body), body, now,
	)
	if err != nil {
		t.Fatal(err)
	}
	valid := BankTransaction{
		PartnerID:          "approved-bank",
		AccountID:          "00000000-0000-4000-8000-000000000001",
		TransactionRef:     payout.TransactionRef(),
		EventType:          "payout",
		AssetCode:          payout.AssetCode(),
		AmountMinorUnits:   payout.AmountMinorUnits(),
		Status:             "confirmed",
		EvidenceSHA256:     "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
		ProviderOccurredAt: now,
	}
	if err := validateBankPayoutConfirmation(valid.AccountID, valid.PartnerID, payout, valid); err != nil {
		t.Fatalf("matching independent confirmation rejected: %v", err)
	}
	valid.TransactionRef = "different-payout"
	if err := validateBankPayoutConfirmation("00000000-0000-4000-8000-000000000001", "approved-bank", payout, valid); !errors.Is(err, ErrBankConfirmationMismatch) {
		t.Fatalf("mismatched payout was accepted: %v", err)
	}
}

func TestPostgresMigrationAndTransactionIntegration(t *testing.T) {
	databaseURL := os.Getenv("ISSUER_TEST_DATABASE_URL")
	if databaseURL == "" {
		t.Skip("ISSUER_TEST_DATABASE_URL is not set; PostgreSQL integration checks were not run")
	}
	store, err := OpenPostgres(context.Background(), databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	if err := store.RunMigrations(context.Background()); err != nil {
		t.Fatal(err)
	}
	if err := store.RunMigrations(context.Background()); err != nil {
		t.Fatalf("migration is not safely repeatable: %v", err)
	}

	var configuredAssets, enabledAssets int
	if err := store.db.QueryRowContext(context.Background(), `
		SELECT COUNT(*), COUNT(*) FILTER (WHERE issuance_enabled)
		FROM issuer_assets`).Scan(&configuredAssets, &enabledAssets); err != nil {
		t.Fatal(err)
	}
	if configuredAssets != 2 || enabledAssets != 0 {
		t.Fatalf("expected two disabled asset specifications, got assets=%d enabled=%d", configuredAssets, enabledAssets)
	}

	tx, err := store.db.BeginTx(context.Background(), nil)
	if err != nil {
		t.Fatal(err)
	}
	_, err = tx.ExecContext(context.Background(), `
		INSERT INTO approved_partners (partner_id, legal_name, partner_type, status)
		VALUES ('issuer-integration-test', 'Integration Test Fixture', 'bank', 'pending')`)
	if err != nil {
		tx.Rollback()
		t.Fatal(err)
	}
	_, duplicateErr := tx.ExecContext(context.Background(), `
		INSERT INTO approved_partners (partner_id, legal_name, partner_type, status)
		VALUES ('issuer-integration-test', 'Duplicate Fixture', 'bank', 'pending')`)
	if duplicateErr == nil {
		tx.Rollback()
		t.Fatal("duplicate partner key unexpectedly succeeded")
	}
	if err := tx.Rollback(); err != nil {
		t.Fatal(err)
	}
	var persisted int
	if err := store.db.QueryRowContext(context.Background(), `
		SELECT COUNT(*) FROM approved_partners WHERE partner_id = 'issuer-integration-test'`).Scan(&persisted); err != nil {
		t.Fatal(err)
	}
	if persisted != 0 {
		t.Fatalf("rolled-back fixture persisted: count=%d", persisted)
	}

	tx, err = store.db.BeginTx(context.Background(), nil)
	if err != nil {
		t.Fatal(err)
	}
	_, err = tx.ExecContext(context.Background(), `
		INSERT INTO redemptions (
			redemption_id, asset_code, request_idempotency_key, requester_address,
			payout_reference_hash, amount_token_units, payout_amount_minor_units,
			status
		) VALUES (
			'00000000-0000-4000-8000-000000000002', 'SQM-USD',
			'invalid-integration-redemption', 'sqm1fixture', decode(repeat('00', 32), 'hex'),
			1, 1, 'burned'
		)`)
	if err == nil {
		tx.Rollback()
		t.Fatal("redemption inserted directly into a settled state")
	}
	if err := tx.Rollback(); err != nil {
		t.Fatal(err)
	}
}

func TestNewPostgresStoreRejectsNilDatabase(t *testing.T) {
	store, err := NewPostgresStore((*sql.DB)(nil))
	if store != nil || !errors.Is(err, ErrDatabaseUnavailable) {
		t.Fatalf("expected nil store and ErrDatabaseUnavailable, got store=%v err=%v", store, err)
	}
}

func TestNewUUID(t *testing.T) {
	value, err := newUUID()
	if err != nil {
		t.Fatal(err)
	}
	if len(value) != 36 || value[14] != '4' {
		t.Fatalf("expected RFC 4122 UUIDv4, got %q", value)
	}
	switch value[19] {
	case '8', '9', 'a', 'b':
	default:
		t.Fatalf("invalid UUID variant: %q", value)
	}
}
