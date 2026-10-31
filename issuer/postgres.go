package issuer

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"embed"
	"encoding/hex"
	"errors"
	"fmt"
	"net/url"
	"time"

	_ "github.com/lib/pq"
)

var (
	ErrInvalidDatabaseURL       = errors.New("issuer database URL must use PostgreSQL with sslmode=verify-full")
	ErrDatabaseUnavailable      = errors.New("issuer database is unavailable")
	ErrBankAdapterUnavailable   = errors.New("approved banking adapter is unavailable")
	ErrBankConfirmationMismatch = errors.New("bank confirmation does not match the expected transaction")
)

//go:embed migrations/0001_init.sql
var issuerMigrations embed.FS

const (
	initialMigrationVersion = "0001_init"
	migrationAdvisoryLock   = int64(1397838413)
)

type PostgresStore struct {
	db *sql.DB
}

func OpenPostgres(ctx context.Context, databaseURL string) (*PostgresStore, error) {
	if err := validatePostgresURL(databaseURL); err != nil {
		return nil, err
	}
	db, err := sql.Open("postgres", databaseURL)
	if err != nil {
		return nil, fmt.Errorf("%w: open connection: %w", ErrDatabaseUnavailable, err)
	}
	db.SetMaxOpenConns(10)
	db.SetMaxIdleConns(5)
	db.SetConnMaxIdleTime(5 * time.Minute)
	db.SetConnMaxLifetime(30 * time.Minute)
	pingCtx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	if err := db.PingContext(pingCtx); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("%w: connection check failed: %w", ErrDatabaseUnavailable, err)
	}
	return &PostgresStore{db: db}, nil
}

func NewPostgresStore(db *sql.DB) (*PostgresStore, error) {
	if db == nil {
		return nil, ErrDatabaseUnavailable
	}
	return &PostgresStore{db: db}, nil
}

func (s *PostgresStore) Close() error {
	if s == nil || s.db == nil {
		return ErrDatabaseUnavailable
	}
	return s.db.Close()
}

func validatePostgresURL(raw string) error {
	parsed, err := url.Parse(raw)
	if err != nil || (parsed.Scheme != "postgres" && parsed.Scheme != "postgresql") ||
		parsed.Hostname() == "" || parsed.Path == "" {
		return ErrInvalidDatabaseURL
	}
	query, err := url.ParseQuery(parsed.RawQuery)
	if err != nil || len(query["sslmode"]) != 1 || query.Get("sslmode") != "verify-full" {
		return ErrInvalidDatabaseURL
	}
	return nil
}

func (s *PostgresStore) RunMigrations(ctx context.Context) error {
	if s == nil || s.db == nil {
		return ErrDatabaseUnavailable
	}
	migration, err := issuerMigrations.ReadFile("migrations/0001_init.sql")
	if err != nil {
		return fmt.Errorf("read embedded issuer migration: %w", err)
	}
	checksum := sha256.Sum256(migration)
	if _, err := s.db.ExecContext(ctx, `
		CREATE TABLE IF NOT EXISTS public.issuer_schema_migrations (
			version TEXT PRIMARY KEY,
			checksum BYTEA NOT NULL CHECK (octet_length(checksum) = 32),
			applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
		)`); err != nil {
		return fmt.Errorf("create issuer migration registry: %w", err)
	}

	tx, err := s.db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelSerializable})
	if err != nil {
		return fmt.Errorf("begin issuer migration transaction: %w", err)
	}
	defer tx.Rollback()

	if _, err := tx.ExecContext(ctx, `SET LOCAL search_path TO public, pg_catalog`); err != nil {
		return fmt.Errorf("set issuer migration search path: %w", err)
	}
	var lockAcquired bool
	if err := tx.QueryRowContext(ctx,
		`SELECT TRUE FROM (SELECT pg_advisory_xact_lock($1)) AS migration_lock`,
		migrationAdvisoryLock,
	).Scan(&lockAcquired); err != nil {
		return fmt.Errorf("lock issuer migrations: %w", err)
	}
	var appliedChecksum []byte
	err = tx.QueryRowContext(ctx,
		`SELECT checksum FROM public.issuer_schema_migrations WHERE version = $1`,
		initialMigrationVersion,
	).Scan(&appliedChecksum)
	switch {
	case err == nil:
		if !equalBytes(appliedChecksum, checksum[:]) {
			return fmt.Errorf("issuer migration %s checksum differs from the applied migration", initialMigrationVersion)
		}
		return tx.Commit()
	case !errors.Is(err, sql.ErrNoRows):
		return fmt.Errorf("read issuer migration registry: %w", err)
	}
	if _, err := tx.ExecContext(ctx, string(migration)); err != nil {
		return fmt.Errorf("apply issuer migration %s: %w", initialMigrationVersion, err)
	}
	if _, err := tx.ExecContext(ctx,
		`INSERT INTO public.issuer_schema_migrations (version, checksum) VALUES ($1, $2)`,
		initialMigrationVersion, checksum[:],
	); err != nil {
		return fmt.Errorf("record issuer migration %s: %w", initialMigrationVersion, err)
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit issuer migration %s: %w", initialMigrationVersion, err)
	}
	return nil
}

func equalBytes(left, right []byte) bool {
	if len(left) != len(right) {
		return false
	}
	var difference byte
	for i := range left {
		difference |= left[i] ^ right[i]
	}
	return difference == 0
}

func (s *PostgresStore) ReadReserveDashboard(ctx context.Context) (DashboardSnapshot, error) {
	if s == nil || s.db == nil {
		return DashboardSnapshot{}, ErrDashboardUnavailable
	}
	tx, err := s.db.BeginTx(ctx, &sql.TxOptions{
		Isolation: sql.LevelRepeatableRead,
		ReadOnly:  true,
	})
	if err != nil {
		return DashboardSnapshot{}, fmt.Errorf("begin reserve dashboard snapshot: %w", err)
	}
	defer tx.Rollback()

	snapshot := DashboardSnapshot{AsOf: time.Now().UTC()}
	rows, err := tx.QueryContext(ctx, `
		SELECT
			l.asset_code,
			l.fiat_currency,
			l.confirmed_reserve_minor_units::TEXT,
			l.restricted_reserve_minor_units::TEXT,
			l.reserved_payout_minor_units::TEXT,
			l.eligible_reserve_minor_units::TEXT,
			l.pending_deposit_minor_units::TEXT,
			l.reconciliation_healthy,
			l.reconciled_at,
			(SELECT COUNT(*) FROM public.bank_events e
			 WHERE e.asset_code = l.asset_code AND e.event_type = 'deposit'
			   AND e.status = 'received'),
			(SELECT COUNT(*) FROM public.reserve_entries e
			 WHERE e.asset_code = l.asset_code AND e.entry_type = 'deposit'),
			(SELECT COALESCE(SUM(r.payout_amount_minor_units), 0)::TEXT
			 FROM public.redemptions r
			 WHERE r.asset_code = l.asset_code
			   AND r.status IN ('payout_confirmed', 'burned')),
			(SELECT COALESCE(SUM(r.amount_token_units), 0)::TEXT
			 FROM public.redemptions r
			 WHERE r.asset_code = l.asset_code
			   AND r.status IN ('pending', 'tokens_locked', 'payout_pending',
			                    'payout_confirmed', 'payout_failed')),
			(SELECT r.chain_supply_token_units::TEXT
			 FROM reconciliation_runs r
			 WHERE r.asset_code = l.asset_code AND r.healthy
			 ORDER BY r.reconciled_at DESC, r.reconciliation_id DESC LIMIT 1),
			(SELECT r.liability_minor_units::TEXT
			 FROM reconciliation_runs r
			 WHERE r.asset_code = l.asset_code AND r.healthy
			 ORDER BY r.reconciled_at DESC, r.reconciliation_id DESC LIMIT 1)
		FROM public.current_reserve_ledger l
		ORDER BY l.asset_code`)
	if err != nil {
		return DashboardSnapshot{}, fmt.Errorf("query reserve dashboard assets: %w", err)
	}
	for rows.Next() {
		var asset DashboardAsset
		var restricted, eligible, issued, liability sql.NullString
		var reconciledAt sql.NullTime
		var reconciliationHealthy bool
		var pendingCount, completedCount int64
		if err := rows.Scan(
			&asset.AssetCode, &asset.FiatCurrency, &asset.ConfirmedReserveMinorUnits,
			&restricted, &asset.ReservedPayoutMinorUnits, &eligible,
			&asset.PendingDepositMinorUnits, &reconciliationHealthy, &reconciledAt,
			&pendingCount, &completedCount, &asset.CompletedPayoutMinorUnits,
			&asset.PendingRedemptionTokenUnits, &issued, &liability,
		); err != nil {
			rows.Close()
			return DashboardSnapshot{}, fmt.Errorf("scan reserve dashboard asset: %w", err)
		}
		asset.PendingDepositCount = uint64(pendingCount)
		asset.CompletedDepositCount = uint64(completedCount)
		asset.IssuanceSuspended = true
		asset.IssuedTokenUnits = "unverified"
		asset.OutstandingLiabilityMinor = "unverified"
		asset.RestrictedReserveMinorUnits = "unverified"
		asset.EligibleReserveMinorUnits = "unverified"
		asset.CoveragePercent = "unverified"
		asset.ReconciliationStatus = "unverified"
		if reconciledAt.Valid {
			asset.ReconciliationStatus = "unhealthy"
		}
		if reconciliationHealthy && eligible.Valid && issued.Valid && liability.Valid {
			asset.ReconciliationStatus = "healthy"
			asset.RestrictedReserveMinorUnits = restricted.String
			asset.EligibleReserveMinorUnits = eligible.String
			asset.IssuedTokenUnits = issued.String
			asset.OutstandingLiabilityMinor = liability.String
			asset.CoveragePercent = coveragePercentFromStrings(eligible.String, liability.String)
		}
		snapshot.Assets = append(snapshot.Assets, asset)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return DashboardSnapshot{}, fmt.Errorf("read reserve dashboard assets: %w", err)
	}
	if err := rows.Close(); err != nil {
		return DashboardSnapshot{}, fmt.Errorf("close reserve dashboard assets: %w", err)
	}

	auditRows, err := tx.QueryContext(ctx, `
		SELECT occurred_at, actor_id, action, COALESCE(asset_code, ''), object_id
		FROM public.audit_events
		ORDER BY sequence DESC
		LIMIT 100`)
	if err != nil {
		return DashboardSnapshot{}, fmt.Errorf("query issuer audit history: %w", err)
	}
	for auditRows.Next() {
		var entry DashboardAuditEntry
		if err := auditRows.Scan(&entry.OccurredAt, &entry.Actor, &entry.Action, &entry.AssetCode, &entry.ObjectID); err != nil {
			auditRows.Close()
			return DashboardSnapshot{}, fmt.Errorf("scan issuer audit history: %w", err)
		}
		snapshot.AuditHistory = append(snapshot.AuditHistory, entry)
	}
	if err := auditRows.Err(); err != nil {
		auditRows.Close()
		return DashboardSnapshot{}, fmt.Errorf("read issuer audit history: %w", err)
	}
	if err := auditRows.Close(); err != nil {
		return DashboardSnapshot{}, fmt.Errorf("close issuer audit history: %w", err)
	}
	for left, right := 0, len(snapshot.AuditHistory)-1; left < right; left, right = left+1, right-1 {
		snapshot.AuditHistory[left], snapshot.AuditHistory[right] =
			snapshot.AuditHistory[right], snapshot.AuditHistory[left]
	}
	if err := tx.Commit(); err != nil {
		return DashboardSnapshot{}, fmt.Errorf("commit reserve dashboard snapshot: %w", err)
	}
	return snapshot, nil
}

func coveragePercentFromStrings(reserve, liability string) string {
	reserveAmount, reserveErr := parseAmount(reserve)
	liabilityAmount, liabilityErr := parseAmount(liability)
	if reserveErr != nil || liabilityErr != nil {
		return "unverified"
	}
	return coveragePercent(reserveAmount, liabilityAmount)
}

func (s *PostgresStore) AppendAuditEvent(ctx context.Context, event AuditEvent) (ChainedAuditEvent, error) {
	if s == nil || s.db == nil {
		return ChainedAuditEvent{}, ErrDatabaseUnavailable
	}
	tx, err := s.db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelSerializable})
	if err != nil {
		return ChainedAuditEvent{}, fmt.Errorf("begin audit append transaction: %w", err)
	}
	defer tx.Rollback()

	chained, err := appendAuditEventTx(ctx, tx, event)
	if err != nil {
		return ChainedAuditEvent{}, err
	}
	if err := tx.Commit(); err != nil {
		return ChainedAuditEvent{}, fmt.Errorf("commit issuer audit event: %w", err)
	}
	return chained, nil
}

func appendAuditEventTx(ctx context.Context, tx *sql.Tx, event AuditEvent) (ChainedAuditEvent, error) {
	var lockAcquired bool
	if err := tx.QueryRowContext(ctx,
		`SELECT TRUE FROM (SELECT pg_advisory_xact_lock($1)) AS audit_lock`,
		migrationAdvisoryLock+1,
	).Scan(&lockAcquired); err != nil {
		return ChainedAuditEvent{}, fmt.Errorf("lock issuer audit chain: %w", err)
	}
	var previous []byte
	if err := tx.QueryRowContext(ctx,
		`SELECT last_event_sha256 FROM public.audit_chain_head WHERE singleton = TRUE`,
	).Scan(&previous); err != nil {
		return ChainedAuditEvent{}, fmt.Errorf("read audit chain head: %w", err)
	}
	previousHash := hex.EncodeToString(previous)
	hash, err := HashAuditEvent(event, previousHash)
	if err != nil {
		return ChainedAuditEvent{}, err
	}
	eventHash, err := hex.DecodeString(hash)
	if err != nil {
		return ChainedAuditEvent{}, fmt.Errorf("decode issuer audit digest: %w", err)
	}
	var previousValue any
	if len(previous) != 0 {
		previousValue = previous
	}
	var evidenceValue any
	if event.EvidenceSHA256 != "" {
		evidenceValue, err = hex.DecodeString(event.EvidenceSHA256)
		if err != nil {
			return ChainedAuditEvent{}, ErrInvalidAuditEvent
		}
	}
	_, err = tx.ExecContext(ctx, `
		INSERT INTO public.audit_events (
			event_id, actor_id, action, asset_code, object_type, object_id,
			evidence_sha256, previous_event_sha256, event_sha256, occurred_at
		) VALUES ($1, $2, $3, NULLIF($4, ''), $5, $6, $7, $8, $9, $10)`,
		event.ID, event.ActorID, event.Action, event.AssetCode, event.ObjectType,
		event.ObjectID, evidenceValue, previousValue, eventHash, event.OccurredAt.UTC(),
	)
	if err != nil {
		return ChainedAuditEvent{}, fmt.Errorf("append issuer audit event: %w", err)
	}
	return ChainedAuditEvent{Event: event, PreviousHash: previousHash, Hash: hash}, nil
}

func (s *PostgresStore) RecordBankConfirmedDeposit(
	ctx context.Context,
	accountID string,
	deposit VerifiedDeposit,
	adapter BankingAdapter,
) error {
	if s == nil || s.db == nil {
		return ErrDatabaseUnavailable
	}
	if adapter == nil {
		return ErrBankAdapterUnavailable
	}
	if err := deposit.Validate(); err != nil {
		return err
	}

	var partnerID, assetCode string
	err := s.db.QueryRowContext(ctx, `
		SELECT a.partner_id, a.asset_code
		FROM public.reserve_bank_accounts a
		JOIN public.approved_partners p ON p.partner_id = a.partner_id
		WHERE a.account_id = $1 AND a.enabled
		  AND p.partner_type = 'bank' AND p.status = 'approved'`,
		accountID,
	).Scan(&partnerID, &assetCode)
	if err != nil {
		return fmt.Errorf("resolve approved reserve account: %w", err)
	}
	if assetCode != deposit.assetCode {
		return ErrBankConfirmationMismatch
	}

	confirmation, err := adapter.FetchTransaction(ctx, partnerID, deposit.transactionRef)
	if err != nil {
		return fmt.Errorf("fetch independent bank transaction confirmation: %w", err)
	}
	if err := validateBankDepositConfirmation(accountID, partnerID, deposit, confirmation); err != nil {
		return err
	}
	confirmedAt := confirmation.ProviderOccurredAt.UTC()

	webhookDigest := deposit.payloadSHA256
	bankDigest, err := hex.DecodeString(confirmation.EvidenceSHA256)
	if err != nil {
		return ErrBankConfirmationMismatch
	}
	evidenceInput := make([]byte, 0, len("sqm-verified-deposit-v1")+len(webhookDigest)+len(bankDigest))
	evidenceInput = append(evidenceInput, "sqm-verified-deposit-v1"...)
	evidenceInput = append(evidenceInput, webhookDigest[:]...)
	evidenceInput = append(evidenceInput, bankDigest...)
	evidenceDigest := sha256.Sum256(evidenceInput)

	tx, err := s.db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelSerializable})
	if err != nil {
		return fmt.Errorf("begin confirmed deposit transaction: %w", err)
	}
	defer tx.Rollback()

	var lockedPartner, lockedAsset string
	err = tx.QueryRowContext(ctx, `
		SELECT a.partner_id, a.asset_code
		FROM public.reserve_bank_accounts a
		JOIN public.approved_partners p ON p.partner_id = a.partner_id
		WHERE a.account_id = $1 AND a.enabled
		  AND p.partner_type = 'bank' AND p.status = 'approved'
		FOR UPDATE OF a, p`,
		accountID,
	).Scan(&lockedPartner, &lockedAsset)
	if err != nil {
		return fmt.Errorf("recheck approved reserve account: %w", err)
	}
	if lockedPartner != partnerID || lockedAsset != deposit.assetCode {
		return ErrBankConfirmationMismatch
	}

	_, err = tx.ExecContext(ctx, `
		INSERT INTO public.bank_events (
			event_id, transaction_reference, event_type, account_id, asset_code,
			amount_minor_units, status, payload_sha256
		) VALUES ($1, $2, 'deposit', $3, $4, $5, 'received', $6)`,
		deposit.eventID, deposit.transactionRef, accountID, deposit.assetCode,
		deposit.amountMinorUnits, deposit.payloadSHA256[:],
	)
	if err != nil {
		return fmt.Errorf("record verified deposit event: %w", err)
	}
	result, err := tx.ExecContext(ctx, `
		UPDATE public.bank_events
		SET status = 'confirmed', bank_confirmed_at = $1
		WHERE event_id = $2 AND status = 'received'`,
		confirmedAt, deposit.eventID,
	)
	if err != nil {
		return fmt.Errorf("confirm bank deposit event: %w", err)
	}
	updated, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("check confirmed deposit update: %w", err)
	}
	if updated != 1 {
		return ErrBankConfirmationMismatch
	}

	entryID, err := newUUID()
	if err != nil {
		return fmt.Errorf("generate reserve entry identifier: %w", err)
	}
	_, err = tx.ExecContext(ctx, `
		INSERT INTO public.reserve_entries (
			entry_id, asset_code, entry_type, amount_minor_units, bank_event_id,
			bank_transaction_reference, confirmed_at, source_evidence_sha256
		) VALUES ($1, $2, 'deposit', $3, $4, $5, $6, $7)`,
		entryID, deposit.assetCode, deposit.amountMinorUnits, deposit.eventID,
		deposit.transactionRef, confirmedAt, evidenceDigest[:],
	)
	if err != nil {
		return fmt.Errorf("record confirmed reserve entry: %w", err)
	}
	_, err = appendAuditEventTx(ctx, tx, AuditEvent{
		ID:             entryID,
		ActorID:        "bank-adapter:" + partnerID,
		Action:         "bank.deposit.confirmed",
		AssetCode:      deposit.assetCode,
		ObjectType:     "bank_event",
		ObjectID:       deposit.eventID,
		EvidenceSHA256: hex.EncodeToString(evidenceDigest[:]),
		OccurredAt:     confirmedAt,
	})
	if err != nil {
		return fmt.Errorf("audit confirmed bank deposit: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit confirmed bank deposit: %w", err)
	}
	return nil
}

func (s *PostgresStore) RecordBankConfirmedPayout(
	ctx context.Context,
	redemptionID, accountID string,
	payout VerifiedPayout,
	adapter BankingAdapter,
) error {
	if s == nil || s.db == nil {
		return ErrDatabaseUnavailable
	}
	if adapter == nil {
		return ErrBankAdapterUnavailable
	}
	if err := payout.Validate(); err != nil {
		return err
	}

	var assetCode, payoutAmount, state string
	var payoutReference sql.NullString
	err := s.db.QueryRowContext(ctx, `
		SELECT asset_code, payout_amount_minor_units::TEXT, status,
		       payout_transaction_reference
		FROM public.redemptions
		WHERE redemption_id = $1`,
		redemptionID,
	).Scan(&assetCode, &payoutAmount, &state, &payoutReference)
	if err != nil {
		return fmt.Errorf("resolve redemption payout: %w", err)
	}
	if state != string(RedemptionPayoutPending) ||
		assetCode != payout.assetCode || payoutAmount != payout.amountMinorUnits ||
		!payoutReference.Valid || payoutReference.String != payout.transactionRef {
		return ErrBankConfirmationMismatch
	}

	var partnerID, accountAsset string
	err = s.db.QueryRowContext(ctx, `
		SELECT a.partner_id, a.asset_code
		FROM public.reserve_bank_accounts a
		JOIN public.approved_partners p ON p.partner_id = a.partner_id
		WHERE a.account_id = $1 AND a.enabled
		  AND p.partner_type = 'bank' AND p.status = 'approved'`,
		accountID,
	).Scan(&partnerID, &accountAsset)
	if err != nil {
		return fmt.Errorf("resolve approved payout account: %w", err)
	}
	if accountAsset != payout.assetCode {
		return ErrBankConfirmationMismatch
	}

	confirmation, err := adapter.FetchPayout(ctx, partnerID, payout.transactionRef)
	if err != nil {
		return fmt.Errorf("fetch independent bank payout confirmation: %w", err)
	}
	if err := validateBankPayoutConfirmation(accountID, partnerID, payout, confirmation); err != nil {
		return err
	}
	confirmedAt := confirmation.ProviderOccurredAt.UTC()

	webhookDigest := payout.payloadSHA256
	bankDigest, err := hex.DecodeString(confirmation.EvidenceSHA256)
	if err != nil {
		return ErrBankConfirmationMismatch
	}
	evidenceInput := make([]byte, 0, len("sqm-verified-payout-v1")+len(webhookDigest)+len(bankDigest))
	evidenceInput = append(evidenceInput, "sqm-verified-payout-v1"...)
	evidenceInput = append(evidenceInput, webhookDigest[:]...)
	evidenceInput = append(evidenceInput, bankDigest...)
	evidenceDigest := sha256.Sum256(evidenceInput)

	tx, err := s.db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelSerializable})
	if err != nil {
		return fmt.Errorf("begin confirmed payout transaction: %w", err)
	}
	defer tx.Rollback()

	var lockedAsset, lockedAmount, lockedState string
	var lockedReference sql.NullString
	err = tx.QueryRowContext(ctx, `
		SELECT asset_code, payout_amount_minor_units::TEXT, status,
		       payout_transaction_reference
		FROM public.redemptions
		WHERE redemption_id = $1
		FOR UPDATE`,
		redemptionID,
	).Scan(&lockedAsset, &lockedAmount, &lockedState, &lockedReference)
	if err != nil {
		return fmt.Errorf("lock redemption payout: %w", err)
	}
	if lockedState != string(RedemptionPayoutPending) ||
		lockedAsset != payout.assetCode || lockedAmount != payout.amountMinorUnits ||
		!lockedReference.Valid || lockedReference.String != payout.transactionRef {
		return ErrBankConfirmationMismatch
	}

	var lockedPartner, lockedAccountAsset string
	err = tx.QueryRowContext(ctx, `
		SELECT a.partner_id, a.asset_code
		FROM public.reserve_bank_accounts a
		JOIN public.approved_partners p ON p.partner_id = a.partner_id
		WHERE a.account_id = $1 AND a.enabled
		  AND p.partner_type = 'bank' AND p.status = 'approved'
		FOR UPDATE OF a, p`,
		accountID,
	).Scan(&lockedPartner, &lockedAccountAsset)
	if err != nil {
		return fmt.Errorf("recheck approved payout account: %w", err)
	}
	if lockedPartner != partnerID || lockedAccountAsset != payout.assetCode {
		return ErrBankConfirmationMismatch
	}

	_, err = tx.ExecContext(ctx, `
		INSERT INTO public.bank_events (
			event_id, transaction_reference, event_type, account_id, asset_code,
			amount_minor_units, status, payload_sha256
		) VALUES ($1, $2, 'payout', $3, $4, $5, 'received', $6)`,
		payout.eventID, payout.transactionRef, accountID, payout.assetCode,
		payout.amountMinorUnits, payout.payloadSHA256[:],
	)
	if err != nil {
		return fmt.Errorf("record verified payout event: %w", err)
	}
	result, err := tx.ExecContext(ctx, `
		UPDATE public.bank_events
		SET status = 'confirmed', bank_confirmed_at = $1
		WHERE event_id = $2 AND status = 'received'`,
		confirmedAt, payout.eventID,
	)
	if err != nil {
		return fmt.Errorf("confirm bank payout event: %w", err)
	}
	updated, err := result.RowsAffected()
	if err != nil {
		return fmt.Errorf("check confirmed payout update: %w", err)
	}
	if updated != 1 {
		return ErrBankConfirmationMismatch
	}

	result, err = tx.ExecContext(ctx, `
		UPDATE public.redemptions
		SET status = 'payout_confirmed', payout_event_id = $1, updated_at = now()
		WHERE redemption_id = $2 AND status = 'payout_pending'`,
		payout.eventID, redemptionID,
	)
	if err != nil {
		return fmt.Errorf("advance confirmed redemption payout: %w", err)
	}
	updated, err = result.RowsAffected()
	if err != nil {
		return fmt.Errorf("check redemption payout transition: %w", err)
	}
	if updated != 1 {
		return ErrBankConfirmationMismatch
	}

	entryID, err := newUUID()
	if err != nil {
		return fmt.Errorf("generate settled payout entry identifier: %w", err)
	}
	_, err = tx.ExecContext(ctx, `
		INSERT INTO public.reserve_entries (
			entry_id, asset_code, entry_type, amount_minor_units, bank_event_id,
			bank_transaction_reference, confirmed_at, source_evidence_sha256
		) VALUES ($1, $2, 'settled_redemption', $3, $4, $5, $6, $7)`,
		entryID, payout.assetCode, payout.amountMinorUnits, payout.eventID,
		payout.transactionRef, confirmedAt, evidenceDigest[:],
	)
	if err != nil {
		return fmt.Errorf("record settled redemption reserve entry: %w", err)
	}
	_, err = appendAuditEventTx(ctx, tx, AuditEvent{
		ID:             entryID,
		ActorID:        "bank-adapter:" + partnerID,
		Action:         "bank.redemption.paid",
		AssetCode:      payout.assetCode,
		ObjectType:     "redemption",
		ObjectID:       redemptionID,
		EvidenceSHA256: hex.EncodeToString(evidenceDigest[:]),
		OccurredAt:     confirmedAt,
	})
	if err != nil {
		return fmt.Errorf("audit confirmed bank payout: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit confirmed bank payout: %w", err)
	}
	return nil
}

func validateBankDepositConfirmation(
	accountID, partnerID string,
	deposit VerifiedDeposit,
	confirmation BankTransaction,
) error {
	if confirmation.PartnerID != partnerID ||
		confirmation.AccountID != accountID ||
		confirmation.TransactionRef != deposit.transactionRef ||
		confirmation.EventType != "deposit" ||
		confirmation.AssetCode != deposit.assetCode ||
		confirmation.AmountMinorUnits != deposit.amountMinorUnits ||
		confirmation.Status != "confirmed" ||
		confirmation.ProviderOccurredAt.IsZero() {
		return ErrBankConfirmationMismatch
	}
	if _, err := parseHash(confirmation.EvidenceSHA256); err != nil {
		return ErrBankConfirmationMismatch
	}
	if confirmation.ProviderOccurredAt.After(time.Now().Add(5 * time.Minute)) {
		return ErrBankConfirmationMismatch
	}
	return nil
}

func validateBankPayoutConfirmation(
	accountID, partnerID string,
	payout VerifiedPayout,
	confirmation BankTransaction,
) error {
	if confirmation.PartnerID != partnerID ||
		confirmation.AccountID != accountID ||
		confirmation.TransactionRef != payout.transactionRef ||
		confirmation.EventType != "payout" ||
		confirmation.AssetCode != payout.assetCode ||
		confirmation.AmountMinorUnits != payout.amountMinorUnits ||
		confirmation.Status != "confirmed" ||
		confirmation.ProviderOccurredAt.IsZero() {
		return ErrBankConfirmationMismatch
	}
	if _, err := parseHash(confirmation.EvidenceSHA256); err != nil {
		return ErrBankConfirmationMismatch
	}
	if confirmation.ProviderOccurredAt.After(time.Now().Add(5 * time.Minute)) {
		return ErrBankConfirmationMismatch
	}
	return nil
}

func newUUID() (string, error) {
	var value [16]byte
	if _, err := rand.Read(value[:]); err != nil {
		return "", err
	}
	value[6] = value[6]&0x0f | 0x40
	value[8] = value[8]&0x3f | 0x80
	return fmt.Sprintf("%08x-%04x-%04x-%04x-%012x",
		value[0:4], value[4:6], value[6:8], value[8:10], value[10:16]), nil
}

var _ DashboardReader = (*PostgresStore)(nil)
