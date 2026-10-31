package exchange

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"embed"
	"encoding/hex"
	"errors"
	"fmt"
	"net/url"
	"strings"
	"time"

	_ "github.com/lib/pq"
)

//go:embed migrations/*.sql
var migrations embed.FS

type Store interface {
	CreateIssuerApplication(context.Context, Principal, IssuerApplicationInput, string) (IssuerApplication, error)
	GetIssuerApplication(context.Context, string) (IssuerApplication, error)
	ListIssuerApplications(context.Context, string, int) ([]IssuerApplication, error)
	ListApplicationEvents(context.Context, string) ([]ApplicationEvent, error)
	DecideIssuerApplication(context.Context, Principal, string, ReviewDecisionInput, string) (IssuerApplication, error)
	GetExchangeStatus(context.Context, string) (ExchangeStatus, error)
	Close() error
}

type PostgresStore struct { db *sql.DB }

func OpenPostgres(ctx context.Context, databaseURL string) (*PostgresStore, error) {
	parsed, err := url.Parse(databaseURL)
	if err != nil || (parsed.Scheme != "postgres" && parsed.Scheme != "postgresql") {
		return nil, errors.New("DATABASE_URL must be a PostgreSQL URL")
	}
	if parsed.Query().Get("sslmode") != "verify-full" {
		return nil, errors.New("DATABASE_URL must require sslmode=verify-full")
	}
	db, err := sql.Open("postgres", databaseURL)
	if err != nil { return nil, fmt.Errorf("open PostgreSQL: %w", err) }
	db.SetMaxOpenConns(20)
	db.SetMaxIdleConns(5)
	db.SetConnMaxLifetime(30 * time.Minute)
	if err := db.PingContext(ctx); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("verify PostgreSQL connection: %w", err)
	}
	return &PostgresStore{db: db}, nil
}

func (s *PostgresStore) Close() error { return s.db.Close() }

func (s *PostgresStore) RunMigrations(ctx context.Context) error {
	raw, err := migrations.ReadFile("migrations/0001_exchange_operations.sql")
	if err != nil { return err }
	sum := sha256.Sum256(raw)
	checksum := hex.EncodeToString(sum[:])
	tx, err := s.db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelSerializable})
	if err != nil { return err }
	defer tx.Rollback()

	if _, err := tx.ExecContext(ctx, `
		CREATE TABLE IF NOT EXISTS exchange_schema_migrations (
			version BIGINT PRIMARY KEY,
			checksum TEXT NOT NULL,
			applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
		)`); err != nil { return err }

	var existing string
	err = tx.QueryRowContext(ctx, "SELECT checksum FROM exchange_schema_migrations WHERE version = 1").Scan(&existing)
	if err == nil {
		if existing != checksum { return errors.New("exchange migration 1 checksum mismatch; manual reconciliation required") }
		return tx.Commit()
	}
	if !errors.Is(err, sql.ErrNoRows) { return err }
	if _, err := tx.ExecContext(ctx, string(raw)); err != nil {
		return fmt.Errorf("apply exchange migration: %w", err)
	}
	if _, err := tx.ExecContext(ctx, "INSERT INTO exchange_schema_migrations(version, checksum) VALUES (1, $1)", checksum); err != nil { return err }
	return tx.Commit()
}

func (s *PostgresStore) CreateIssuerApplication(ctx context.Context, principal Principal, input IssuerApplicationInput, requestID string) (IssuerApplication, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil { return IssuerApplication{}, err }
	defer tx.Rollback()

	var organisationID string
	err = tx.QueryRowContext(ctx, `
		INSERT INTO exchange_organisations
			(legal_name, registration_country, registration_number, registered_address, website)
		VALUES ($1,$2,$3,$4,$5)
		RETURNING id::text`,
		strings.TrimSpace(input.LegalName), strings.ToUpper(strings.TrimSpace(input.RegistrationCountry)),
		strings.TrimSpace(input.RegistrationNumber), strings.TrimSpace(input.RegisteredAddress),
		strings.TrimSpace(input.Website)).Scan(&organisationID)
	if err != nil {
		if strings.Contains(strings.ToLower(err.Error()), "unique") || strings.Contains(strings.ToLower(err.Error()), "duplicate") {
			return IssuerApplication{}, ErrConflict
		}
		return IssuerApplication{}, err
	}

	var applicationID string
	err = tx.QueryRowContext(ctx, `
		INSERT INTO exchange_issuer_applications
			(organisation_id, applicant_subject, applicant_email, applicant_phone,
			 proposed_security_type, proposed_market_segment, business_description,
			 capital_seeking_minor, currency)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
		RETURNING id::text`,
		organisationID, principal.Subject, strings.TrimSpace(input.ApplicantEmail),
		strings.TrimSpace(input.ApplicantPhone), input.ProposedSecurityType,
		input.ProposedMarketSegment, strings.TrimSpace(input.BusinessDescription),
		input.CapitalSeekingMinor, input.Currency).Scan(&applicationID)
	if err != nil { return IssuerApplication{}, err }

	if _, err := tx.ExecContext(ctx, `
		INSERT INTO exchange_issuer_application_events
			(application_id, actor_subject, actor_role, event_type, new_status, reason)
		VALUES ($1,$2,'ISSUER_APPLICANT','APPLICATION_SUBMITTED','SUBMITTED','Issuer application received')`,
		applicationID, principal.Subject); err != nil { return IssuerApplication{}, err }
	if _, err := tx.ExecContext(ctx, `
		INSERT INTO exchange_audit_events
			(actor_subject, actor_role, event_type, resource_type, resource_id, request_id)
		VALUES ($1,'ISSUER_APPLICANT','APPLICATION_SUBMITTED','ISSUER_APPLICATION',$2,$3)`,
		principal.Subject, applicationID, requestID); err != nil { return IssuerApplication{}, err }

	result, err := scanApplication(tx.QueryRowContext(ctx, applicationSelect+" WHERE a.id = $1", applicationID))
	if err != nil { return IssuerApplication{}, err }
	if err := tx.Commit(); err != nil { return IssuerApplication{}, err }
	return result, nil
}

const applicationSelect = `
SELECT a.id::text, o.legal_name, o.registration_country, o.registration_number,
       o.registered_address, o.website, a.applicant_email, a.applicant_phone,
       a.proposed_security_type, a.proposed_market_segment, a.business_description,
       a.capital_seeking_minor, a.currency, a.status, a.applicant_subject,
       COALESCE(a.assigned_to_subject,''), a.created_at, a.updated_at
FROM exchange_issuer_applications a
JOIN exchange_organisations o ON o.id = a.organisation_id`

type scanner interface { Scan(...any) error }

func scanApplication(row scanner) (IssuerApplication, error) {
	var a IssuerApplication
	err := row.Scan(&a.ID, &a.LegalName, &a.RegistrationCountry, &a.RegistrationNumber,
		&a.RegisteredAddress, &a.Website, &a.ApplicantEmail, &a.ApplicantPhone,
		&a.ProposedSecurityType, &a.ProposedMarketSegment, &a.BusinessDescription,
		&a.CapitalSeekingMinor, &a.Currency, &a.Status, &a.SubmittedBy,
		&a.AssignedTo, &a.CreatedAt, &a.UpdatedAt)
	return a, err
}

func (s *PostgresStore) GetIssuerApplication(ctx context.Context, id string) (IssuerApplication, error) {
	a, err := scanApplication(s.db.QueryRowContext(ctx, applicationSelect+" WHERE a.id = $1", id))
	if errors.Is(err, sql.ErrNoRows) { return IssuerApplication{}, ErrNotFound }
	return a, err
}

func (s *PostgresStore) ListIssuerApplications(ctx context.Context, status string, limit int) ([]IssuerApplication, error) {
	rows, err := s.db.QueryContext(ctx, applicationSelect+`
		WHERE ($1 = '' OR a.status = $1)
		ORDER BY a.created_at DESC
		LIMIT $2`, status, limit)
	if err != nil { return nil, err }
	defer rows.Close()
	result := make([]IssuerApplication, 0)
	for rows.Next() {
		a, err := scanApplication(rows)
		if err != nil { return nil, err }
		result = append(result, a)
	}
	return result, rows.Err()
}

func (s *PostgresStore) ListApplicationEvents(ctx context.Context, applicationID string) ([]ApplicationEvent, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT id::text, application_id::text, actor_subject, actor_role,
		       event_type, COALESCE(previous_status,''), COALESCE(new_status,''),
		       reason, occurred_at
		FROM exchange_issuer_application_events
		WHERE application_id = $1
		ORDER BY occurred_at ASC, id ASC`, applicationID)
	if err != nil { return nil, err }
	defer rows.Close()
	result := make([]ApplicationEvent, 0)
	for rows.Next() {
		var e ApplicationEvent
		if err := rows.Scan(&e.ID, &e.ApplicationID, &e.ActorSubject, &e.ActorRole,
			&e.EventType, &e.PreviousStatus, &e.NewStatus, &e.Reason, &e.OccurredAt); err != nil {
			return nil, err
		}
		result = append(result, e)
	}
	return result, rows.Err()
}

func (s *PostgresStore) DecideIssuerApplication(ctx context.Context, principal Principal, applicationID string, decision ReviewDecisionInput, requestID string) (IssuerApplication, error) {
	tx, err := s.db.BeginTx(ctx, &sql.TxOptions{Isolation: sql.LevelSerializable})
	if err != nil { return IssuerApplication{}, err }
	defer tx.Rollback()

	var current string
	err = tx.QueryRowContext(ctx, "SELECT status FROM exchange_issuer_applications WHERE id = $1 FOR UPDATE", applicationID).Scan(&current)
	if errors.Is(err, sql.ErrNoRows) { return IssuerApplication{}, ErrNotFound }
	if err != nil { return IssuerApplication{}, err }
	next, err := NextApplicationStatus(current, decision.Decision)
	if err != nil { return IssuerApplication{}, err }

	role := highestReviewRole(principal)
	if _, err := tx.ExecContext(ctx, `
		UPDATE exchange_issuer_applications
		SET status = $2, assigned_to_subject = COALESCE(assigned_to_subject,$3), updated_at = now()
		WHERE id = $1`, applicationID, next, principal.Subject); err != nil { return IssuerApplication{}, err }
	if _, err := tx.ExecContext(ctx, `
		INSERT INTO exchange_issuer_application_events
			(application_id, actor_subject, actor_role, event_type, previous_status, new_status, reason)
		VALUES ($1,$2,$3,$4,$5,$6,$7)`,
		applicationID, principal.Subject, role, decision.Decision, current, next, strings.TrimSpace(decision.Reason)); err != nil {
		return IssuerApplication{}, err
	}
	if _, err := tx.ExecContext(ctx, `
		INSERT INTO exchange_audit_events
			(actor_subject, actor_role, event_type, resource_type, resource_id, request_id)
		VALUES ($1,$2,$3,'ISSUER_APPLICATION',$4,$5)`,
		principal.Subject, role, decision.Decision, applicationID, requestID); err != nil {
		return IssuerApplication{}, err
	}
	result, err := scanApplication(tx.QueryRowContext(ctx, applicationSelect+" WHERE a.id = $1", applicationID))
	if err != nil { return IssuerApplication{}, err }
	if err := tx.Commit(); err != nil { return IssuerApplication{}, err }
	return result, nil
}

func highestReviewRole(p Principal) string {
	if p.HasRole("EXCHANGE_COMPLIANCE") { return "EXCHANGE_COMPLIANCE" }
	return "EXCHANGE_REVIEW_OFFICER"
}

func (s *PostgresStore) GetExchangeStatus(ctx context.Context, legalName string) (ExchangeStatus, error) {
	status := ExchangeStatus{OperatorName: legalName, RegulatoryApprovalStatus: "NOT_RECORDED", TradingEnabled: false, Reason: "No verified securities-exchange approval is recorded. Trading is not enabled."}
	err := s.db.QueryRowContext(ctx, `
		SELECT reference_number, status
		FROM exchange_regulatory_authorisations
		WHERE authorisation_type = 'SECURITIES_EXCHANGE'
		ORDER BY created_at DESC
		LIMIT 1`).Scan(&status.ApprovalReference, &status.RegulatoryApprovalStatus)
	if errors.Is(err, sql.ErrNoRows) { return status, nil }
	if err != nil { return ExchangeStatus{}, err }
	if status.RegulatoryApprovalStatus == "VERIFIED" {
		var valid bool
		err := s.db.QueryRowContext(ctx, `
			SELECT (effective_at <= now() AND (expires_at IS NULL OR expires_at > now()))
			FROM exchange_regulatory_authorisations
			WHERE authorisation_type='SECURITIES_EXCHANGE' AND reference_number=$1`,
			status.ApprovalReference).Scan(&valid)
		if err != nil { return ExchangeStatus{}, err }
		status.TradingEnabled = valid
		if valid { status.Reason = "A verified authorisation is recorded. Separate operational readiness checks and regulator launch approval are still required." }
	}
	return status, nil
}
