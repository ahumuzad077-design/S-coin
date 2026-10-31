REVOKE CREATE ON SCHEMA public FROM PUBLIC;

CREATE TABLE issuer_assets (
    asset_code TEXT PRIMARY KEY,
    base_denom TEXT NOT NULL UNIQUE,
    fiat_currency CHAR(3) NOT NULL UNIQUE,
    token_decimals SMALLINT NOT NULL CHECK (token_decimals BETWEEN 0 AND 2),
    fiat_minor_units_per_base_unit BIGINT NOT NULL
        CHECK (fiat_minor_units_per_base_unit > 0),
    issuance_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (
        (asset_code = 'SQM-UGX' AND base_denom = 'sqmugx'
            AND fiat_currency = 'UGX' AND token_decimals = 0
            AND fiat_minor_units_per_base_unit = 1)
        OR
        (asset_code = 'SQM-USD' AND base_denom = 'sqmusd'
            AND fiat_currency = 'USD' AND token_decimals = 2
            AND fiat_minor_units_per_base_unit = 1)
    )
);

CREATE FUNCTION preserve_asset_specification() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
    IF NEW.asset_code <> OLD.asset_code
        OR NEW.base_denom <> OLD.base_denom
        OR NEW.fiat_currency <> OLD.fiat_currency
        OR NEW.token_decimals <> OLD.token_decimals
        OR NEW.fiat_minor_units_per_base_unit <> OLD.fiat_minor_units_per_base_unit
        OR NEW.created_at <> OLD.created_at THEN
        RAISE EXCEPTION 'cash-backed asset denomination and precision are immutable';
    END IF;
    RETURN NEW;
END;
$$;

CREATE FUNCTION reject_asset_deletion() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
    RAISE EXCEPTION 'cash-backed asset specifications cannot be deleted';
END;
$$;

CREATE TRIGGER issuer_assets_preserve_specification
    BEFORE UPDATE ON issuer_assets
    FOR EACH ROW EXECUTE FUNCTION preserve_asset_specification();

CREATE TRIGGER issuer_assets_no_delete
    BEFORE DELETE OR TRUNCATE ON issuer_assets
    FOR EACH STATEMENT EXECUTE FUNCTION reject_asset_deletion();

INSERT INTO issuer_assets (
    asset_code, base_denom, fiat_currency, token_decimals,
    fiat_minor_units_per_base_unit, issuance_enabled
) VALUES
    ('SQM-UGX', 'sqmugx', 'UGX', 0, 1, FALSE),
    ('SQM-USD', 'sqmusd', 'USD', 2, 1, FALSE);

CREATE TABLE approved_partners (
    partner_id TEXT PRIMARY KEY,
    legal_name TEXT NOT NULL,
    partner_type TEXT NOT NULL CHECK (partner_type IN ('bank', 'custodian')),
    status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'suspended')),
    agreement_reference TEXT,
    approval_evidence_sha256 BYTEA,
    signing_secret_reference TEXT,
    approved_at TIMESTAMPTZ,
    CHECK (
        status <> 'approved'
        OR (
            agreement_reference IS NOT NULL
            AND approval_evidence_sha256 IS NOT NULL
            AND octet_length(approval_evidence_sha256) = 32
            AND approved_at IS NOT NULL
        )
    )
);

CREATE TABLE reserve_bank_accounts (
    account_id UUID PRIMARY KEY,
    asset_code TEXT NOT NULL REFERENCES issuer_assets(asset_code),
    partner_id TEXT NOT NULL REFERENCES approved_partners(partner_id),
    account_reference_sha256 BYTEA NOT NULL UNIQUE
        CHECK (octet_length(account_reference_sha256) = 32),
    enabled BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (account_id, asset_code)
);

CREATE TABLE bank_events (
    event_id TEXT PRIMARY KEY,
    transaction_reference TEXT NOT NULL UNIQUE,
    event_type TEXT NOT NULL CHECK (event_type IN ('deposit', 'payout')),
    account_id UUID NOT NULL REFERENCES reserve_bank_accounts(account_id),
    asset_code TEXT NOT NULL REFERENCES issuer_assets(asset_code),
    amount_minor_units NUMERIC(78, 0) NOT NULL CHECK (amount_minor_units > 0),
    status TEXT NOT NULL CHECK (status IN ('received', 'confirmed', 'rejected')),
    payload_sha256 BYTEA NOT NULL CHECK (octet_length(payload_sha256) = 32),
    bank_confirmed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK ((status = 'confirmed') = (bank_confirmed_at IS NOT NULL)),
    UNIQUE (event_id, asset_code),
    FOREIGN KEY (account_id, asset_code)
        REFERENCES reserve_bank_accounts(account_id, asset_code)
);

CREATE TABLE reserve_entries (
    entry_id UUID PRIMARY KEY,
    asset_code TEXT NOT NULL REFERENCES issuer_assets(asset_code),
    entry_type TEXT NOT NULL CHECK (entry_type IN ('deposit', 'settled_redemption')),
    amount_minor_units NUMERIC(78, 0) NOT NULL CHECK (amount_minor_units > 0),
    bank_event_id TEXT REFERENCES bank_events(event_id),
    bank_transaction_reference TEXT,
    confirmed_at TIMESTAMPTZ NOT NULL,
    source_evidence_sha256 BYTEA NOT NULL CHECK (octet_length(source_evidence_sha256) = 32),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (bank_event_id IS NOT NULL AND bank_transaction_reference IS NOT NULL),
    FOREIGN KEY (bank_event_id, asset_code)
        REFERENCES bank_events(event_id, asset_code)
);

CREATE UNIQUE INDEX reserve_bank_event_once
    ON reserve_entries (bank_event_id)
    WHERE bank_event_id IS NOT NULL;
CREATE UNIQUE INDEX reserve_bank_reference_once
    ON reserve_entries (bank_transaction_reference)
    WHERE bank_transaction_reference IS NOT NULL;

CREATE TABLE chain_supply_observations (
    asset_code TEXT NOT NULL REFERENCES issuer_assets(asset_code),
    chain_id TEXT NOT NULL,
    height BIGINT NOT NULL CHECK (height > 0),
    supply_token_units NUMERIC(78, 0) NOT NULL CHECK (supply_token_units >= 0),
    observed_at TIMESTAMPTZ NOT NULL,
    evidence_sha256 BYTEA NOT NULL CHECK (octet_length(evidence_sha256) = 32),
    PRIMARY KEY (asset_code, chain_id, height)
);

CREATE TABLE reconciliation_runs (
    reconciliation_id UUID PRIMARY KEY,
    asset_code TEXT NOT NULL REFERENCES issuer_assets(asset_code),
    chain_id TEXT NOT NULL,
    chain_height BIGINT NOT NULL CHECK (chain_height > 0),
    bank_balance_minor_units NUMERIC(78, 0),
    ledger_balance_minor_units NUMERIC(78, 0),
    restricted_reserve_minor_units NUMERIC(78, 0),
    reserved_payout_minor_units NUMERIC(78, 0),
    eligible_reserve_minor_units NUMERIC(78, 0),
    chain_supply_token_units NUMERIC(78, 0),
    ledger_liability_token_units NUMERIC(78, 0),
    liability_minor_units NUMERIC(78, 0),
    bank_confirmed BOOLEAN NOT NULL DEFAULT FALSE,
    custodian_confirmed BOOLEAN NOT NULL DEFAULT FALSE,
    healthy BOOLEAN NOT NULL DEFAULT FALSE,
    discrepancy JSONB NOT NULL,
    evidence_sha256 BYTEA CHECK (
        evidence_sha256 IS NULL OR octet_length(evidence_sha256) = 32
    ),
    reconciled_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CHECK (bank_balance_minor_units IS NULL OR bank_balance_minor_units >= 0),
    CHECK (ledger_balance_minor_units IS NULL OR ledger_balance_minor_units >= 0),
    CHECK (restricted_reserve_minor_units IS NULL OR restricted_reserve_minor_units >= 0),
    CHECK (reserved_payout_minor_units IS NULL OR reserved_payout_minor_units >= 0),
    CHECK (eligible_reserve_minor_units IS NULL OR eligible_reserve_minor_units >= 0),
    CHECK (chain_supply_token_units IS NULL OR chain_supply_token_units >= 0),
    CHECK (ledger_liability_token_units IS NULL OR ledger_liability_token_units >= 0),
    CHECK (liability_minor_units IS NULL OR liability_minor_units >= 0),
    FOREIGN KEY (asset_code, chain_id, chain_height)
        REFERENCES chain_supply_observations(asset_code, chain_id, height),
    CHECK (
        healthy = FALSE
        OR (
            bank_confirmed
            AND custodian_confirmed
            AND bank_balance_minor_units IS NOT NULL
            AND ledger_balance_minor_units IS NOT NULL
            AND restricted_reserve_minor_units IS NOT NULL
            AND reserved_payout_minor_units IS NOT NULL
            AND eligible_reserve_minor_units IS NOT NULL
            AND chain_supply_token_units IS NOT NULL
            AND ledger_liability_token_units IS NOT NULL
            AND liability_minor_units IS NOT NULL
            AND evidence_sha256 IS NOT NULL
            AND bank_balance_minor_units = ledger_balance_minor_units
            AND chain_supply_token_units = ledger_liability_token_units
            AND eligible_reserve_minor_units =
                GREATEST(
                    bank_balance_minor_units
                    - restricted_reserve_minor_units
                    - reserved_payout_minor_units,
                    0
                )
            AND restricted_reserve_minor_units + reserved_payout_minor_units
                <= bank_balance_minor_units
            AND eligible_reserve_minor_units >= liability_minor_units
        )
    )
);

CREATE FUNCTION validate_reconciliation_amounts() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
    minor_units_per_token BIGINT;
    observed_supply NUMERIC(78, 0);
BEGIN
    SELECT fiat_minor_units_per_base_unit INTO minor_units_per_token
      FROM issuer_assets WHERE asset_code = NEW.asset_code;
    IF minor_units_per_token IS NULL THEN
        RAISE EXCEPTION 'reconciliation asset denomination is not configured';
    END IF;
    IF NEW.ledger_liability_token_units IS NOT NULL
        AND NEW.liability_minor_units IS NOT NULL
        AND NEW.liability_minor_units <>
            NEW.ledger_liability_token_units * minor_units_per_token THEN
        RAISE EXCEPTION 'reconciliation liability does not match the asset denomination';
    END IF;
    IF NEW.chain_id IS NULL OR NEW.chain_height IS NULL THEN
        RAISE EXCEPTION 'reconciliation requires a chain and observed height';
    END IF;
    SELECT supply_token_units INTO observed_supply
      FROM chain_supply_observations
     WHERE asset_code = NEW.asset_code
       AND chain_id = NEW.chain_id
       AND height = NEW.chain_height;
    IF observed_supply IS NULL
        OR observed_supply <> NEW.chain_supply_token_units
        OR EXISTS (
            SELECT 1 FROM chain_supply_observations
             WHERE asset_code = NEW.asset_code
               AND chain_id = NEW.chain_id
               AND height > NEW.chain_height
        ) THEN
        RAISE EXCEPTION 'reconciliation must reference the latest recorded chain supply observation';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER reconciliation_amounts_match_asset
    BEFORE INSERT ON reconciliation_runs
    FOR EACH ROW EXECUTE FUNCTION validate_reconciliation_amounts();

CREATE TABLE production_launch_gate (
    singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton),
    production_mode BOOLEAN NOT NULL DEFAULT FALSE,
    legal_opinion BOOLEAN NOT NULL DEFAULT FALSE,
    regulatory_approval BOOLEAN NOT NULL DEFAULT FALSE,
    bank_agreement BOOLEAN NOT NULL DEFAULT FALSE,
    custody_agreement BOOLEAN NOT NULL DEFAULT FALSE,
    reserve_funding BOOLEAN NOT NULL DEFAULT FALSE,
    security_assessment BOOLEAN NOT NULL DEFAULT FALSE,
    production_chain BOOLEAN NOT NULL DEFAULT FALSE,
    approver_id TEXT,
    evidence_sha256 BYTEA CHECK (
        evidence_sha256 IS NULL OR octet_length(evidence_sha256) = 32
    ),
    approved_at TIMESTAMPTZ,
    CHECK (
        NOT (
            production_mode AND legal_opinion AND regulatory_approval
            AND bank_agreement AND custody_agreement AND reserve_funding
            AND security_assessment AND production_chain
        )
        OR (
            approver_id IS NOT NULL AND evidence_sha256 IS NOT NULL
            AND approved_at IS NOT NULL
        )
    )
);

INSERT INTO production_launch_gate (singleton) VALUES (TRUE);

CREATE TABLE treasury_policy (
    singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton),
    required_signatures INTEGER NOT NULL CHECK (required_signatures >= 2),
    enabled BOOLEAN NOT NULL DEFAULT FALSE
);

INSERT INTO treasury_policy (singleton, required_signatures, enabled)
VALUES (TRUE, 2, FALSE);

CREATE TABLE treasury_operations (
    operation_id UUID PRIMARY KEY,
    action TEXT NOT NULL CHECK (action IN ('mint', 'lock', 'payout', 'burn', 'release_lock')),
    asset_code TEXT NOT NULL REFERENCES issuer_assets(asset_code),
    amount NUMERIC(78, 0) NOT NULL CHECK (amount > 0),
    recipient TEXT NOT NULL,
    chain_id TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    operation_digest BYTEA NOT NULL CHECK (octet_length(operation_digest) = 32),
    status TEXT NOT NULL CHECK (
        status IN ('awaiting_approval', 'authorized', 'submitted', 'confirmed', 'failed', 'expired')
    ),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE issuance_operations (
    operation_id UUID PRIMARY KEY REFERENCES treasury_operations(operation_id),
    asset_code TEXT NOT NULL REFERENCES issuer_assets(asset_code),
    bank_event_id TEXT NOT NULL UNIQUE,
    recipient_address TEXT NOT NULL,
    amount_token_units NUMERIC(78, 0) NOT NULL CHECK (amount_token_units > 0),
    chain_id TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('authorized', 'submitted', 'confirmed', 'failed')),
    chain_transaction_hash TEXT UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    FOREIGN KEY (bank_event_id, asset_code)
        REFERENCES bank_events(event_id, asset_code)
);

CREATE TABLE redemptions (
    redemption_id UUID PRIMARY KEY,
    asset_code TEXT NOT NULL REFERENCES issuer_assets(asset_code),
    request_idempotency_key TEXT NOT NULL UNIQUE,
    requester_address TEXT NOT NULL CHECK (requester_address <> ''),
    payout_reference_hash BYTEA NOT NULL CHECK (octet_length(payout_reference_hash) = 32),
    amount_token_units NUMERIC(78, 0) NOT NULL CHECK (amount_token_units > 0),
    payout_amount_minor_units NUMERIC(78, 0) NOT NULL CHECK (payout_amount_minor_units > 0),
    status TEXT NOT NULL CHECK (
        status IN ('pending', 'tokens_locked', 'payout_pending', 'payout_confirmed',
            'payout_failed', 'tokens_released', 'burned', 'failed')
    ),
    lock_transaction_hash TEXT UNIQUE,
    payout_transaction_reference TEXT UNIQUE,
    payout_event_id TEXT UNIQUE,
    burn_transaction_hash TEXT UNIQUE,
    release_transaction_hash TEXT UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    FOREIGN KEY (payout_event_id, asset_code)
        REFERENCES bank_events(event_id, asset_code)
);

CREATE TABLE treasury_signers (
    signer_id TEXT PRIMARY KEY,
    public_key BYTEA NOT NULL CHECK (octet_length(public_key) = 32),
    role TEXT NOT NULL,
    enabled BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE treasury_approvals (
    operation_id UUID NOT NULL REFERENCES treasury_operations(operation_id),
    signer_id TEXT NOT NULL REFERENCES treasury_signers(signer_id),
    operation_digest BYTEA NOT NULL CHECK (octet_length(operation_digest) = 32),
    signature BYTEA NOT NULL CHECK (octet_length(signature) = 64),
    signed_at TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (operation_id, signer_id)
);

CREATE FUNCTION validate_treasury_operation_transition() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
    required_count INTEGER;
    approval_count BIGINT;
    policy_enabled BOOLEAN;
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF NEW.status <> 'awaiting_approval'
            OR NEW.expires_at <= now()
            OR NEW.expires_at > now() + INTERVAL '15 minutes' THEN
            RAISE EXCEPTION 'new treasury operations must be pending and short-lived';
        END IF;
        RETURN NEW;
    END IF;

    IF NOT (
        (OLD.status = 'awaiting_approval' AND NEW.status IN ('authorized', 'failed', 'expired'))
        OR (OLD.status = 'authorized' AND NEW.status IN ('submitted', 'failed', 'expired'))
        OR (OLD.status = 'submitted' AND NEW.status IN ('confirmed', 'failed'))
    ) THEN
        RAISE EXCEPTION 'invalid treasury operation state transition';
    END IF;
    IF NEW.operation_id <> OLD.operation_id
        OR NEW.action <> OLD.action
        OR NEW.asset_code <> OLD.asset_code
        OR NEW.amount <> OLD.amount
        OR NEW.recipient <> OLD.recipient
        OR NEW.chain_id <> OLD.chain_id
        OR NEW.expires_at <> OLD.expires_at
        OR NEW.operation_digest <> OLD.operation_digest
        OR NEW.created_at <> OLD.created_at THEN
        RAISE EXCEPTION 'treasury operation authorization data is immutable';
    END IF;
    IF NEW.status = 'authorized' THEN
        SELECT required_signatures, enabled
          INTO required_count, policy_enabled
          FROM treasury_policy
         WHERE singleton = TRUE;
        SELECT count(*)
          INTO approval_count
          FROM treasury_approvals a
          JOIN treasury_signers s ON s.signer_id = a.signer_id
         WHERE a.operation_id = NEW.operation_id
           AND a.operation_digest = NEW.operation_digest
           AND s.enabled = TRUE AND s.role = 'treasury';
        IF required_count IS NULL OR policy_enabled IS DISTINCT FROM TRUE OR NEW.expires_at <= now()
            OR approval_count < required_count THEN
            RAISE EXCEPTION 'active multisignature quorum is required to authorize';
        END IF;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER treasury_operations_valid_transition
    BEFORE INSERT OR UPDATE ON treasury_operations
    FOR EACH ROW EXECUTE FUNCTION validate_treasury_operation_transition();

CREATE FUNCTION validate_bank_event_creation() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
    partner_status TEXT;
    partner_type TEXT;
    account_enabled BOOLEAN;
BEGIN
    IF NEW.status <> 'received' OR NEW.bank_confirmed_at IS NOT NULL THEN
        RAISE EXCEPTION 'bank events must enter as unconfirmed received events';
    END IF;
    SELECT p.status, p.partner_type, a.enabled
      INTO partner_status, partner_type, account_enabled
      FROM reserve_bank_accounts a
      JOIN approved_partners p ON p.partner_id = a.partner_id
     WHERE a.account_id = NEW.account_id
       AND a.asset_code = NEW.asset_code;
    IF NOT FOUND OR partner_status <> 'approved'
        OR partner_type <> 'bank' OR NOT account_enabled THEN
        RAISE EXCEPTION 'bank event requires an enabled account with an approved bank';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER bank_events_require_approved_source
    BEFORE INSERT ON bank_events
    FOR EACH ROW EXECUTE FUNCTION validate_bank_event_creation();

CREATE FUNCTION validate_treasury_approval() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
    operation_hash BYTEA;
    signer_role TEXT;
    signer_enabled BOOLEAN;
BEGIN
    SELECT operation_digest INTO operation_hash
      FROM treasury_operations
     WHERE operation_id = NEW.operation_id
       AND status IN ('awaiting_approval', 'authorized')
     FOR SHARE;
    SELECT role, enabled INTO signer_role, signer_enabled
      FROM treasury_signers
     WHERE signer_id = NEW.signer_id;
    IF operation_hash IS NULL OR operation_hash <> NEW.operation_digest
        OR signer_role IS DISTINCT FROM 'treasury'
        OR signer_enabled IS DISTINCT FROM TRUE THEN
        RAISE EXCEPTION 'approval must match an active treasury operation and signer';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER treasury_approvals_verified_operation
    BEFORE INSERT ON treasury_approvals
    FOR EACH ROW EXECUTE FUNCTION validate_treasury_approval();

CREATE FUNCTION validate_issuance_transition() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
    operation treasury_operations%ROWTYPE;
    deposit bank_events%ROWTYPE;
    latest_reconciliation reconciliation_runs%ROWTYPE;
    minor_units_per_token BIGINT;
    asset_issuance_enabled BOOLEAN;
    launch_approved BOOLEAN;
    pending_issuance NUMERIC(78, 0);
BEGIN
    IF TG_OP = 'UPDATE' THEN
        IF NOT (
            (OLD.status = 'authorized' AND NEW.status IN ('submitted', 'failed'))
            OR (OLD.status = 'submitted' AND NEW.status IN ('confirmed', 'failed'))
        ) THEN
            RAISE EXCEPTION 'invalid issuance state transition';
        END IF;
        IF NEW.operation_id <> OLD.operation_id
            OR NEW.asset_code <> OLD.asset_code
            OR NEW.bank_event_id <> OLD.bank_event_id
            OR NEW.recipient_address <> OLD.recipient_address
            OR NEW.amount_token_units <> OLD.amount_token_units
            OR NEW.chain_id <> OLD.chain_id
            OR NEW.created_at <> OLD.created_at THEN
            RAISE EXCEPTION 'issuance identity and amount are immutable';
        END IF;
        IF NEW.status IN ('submitted', 'confirmed') AND NEW.chain_transaction_hash IS NULL THEN
            RAISE EXCEPTION 'submitted chain transaction hash is required';
        END IF;
        RETURN NEW;
    END IF;

    SELECT * INTO operation FROM treasury_operations
     WHERE operation_id = NEW.operation_id AND status = 'authorized';
    SELECT * INTO deposit FROM bank_events
     WHERE event_id = NEW.bank_event_id AND status = 'confirmed';
    SELECT fiat_minor_units_per_base_unit, issuance_enabled
      INTO minor_units_per_token, asset_issuance_enabled
      FROM issuer_assets WHERE asset_code = NEW.asset_code;
    PERFORM pg_advisory_xact_lock(hashtext(NEW.asset_code));
    SELECT * INTO latest_reconciliation
      FROM reconciliation_runs
     WHERE asset_code = NEW.asset_code
     ORDER BY reconciled_at DESC, reconciliation_id DESC
     LIMIT 1;
    SELECT (
        production_mode AND legal_opinion AND regulatory_approval
        AND bank_agreement AND custody_agreement AND reserve_funding
        AND security_assessment AND production_chain
        AND approver_id IS NOT NULL AND evidence_sha256 IS NOT NULL
        AND approved_at IS NOT NULL
    ) INTO launch_approved
      FROM production_launch_gate WHERE singleton = TRUE;
    SELECT COALESCE(SUM(amount_token_units), 0) INTO pending_issuance
      FROM issuance_operations
     WHERE asset_code = NEW.asset_code
       AND status IN ('authorized', 'submitted');
    IF operation.operation_id IS NULL OR deposit.event_id IS NULL
        OR minor_units_per_token IS NULL OR asset_issuance_enabled IS DISTINCT FROM TRUE
        OR operation.expires_at <= now()
        OR operation.action <> 'mint'
        OR operation.asset_code <> NEW.asset_code
        OR operation.amount <> NEW.amount_token_units
        OR operation.recipient <> NEW.recipient_address
        OR operation.chain_id <> NEW.chain_id
        OR deposit.event_type <> 'deposit'
        OR deposit.asset_code <> NEW.asset_code
        OR deposit.amount_minor_units <>
            NEW.amount_token_units * minor_units_per_token
        OR NEW.status <> 'authorized'
        OR NEW.chain_transaction_hash IS NOT NULL
        OR launch_approved IS DISTINCT FROM TRUE
        OR latest_reconciliation.reconciliation_id IS NULL
        OR latest_reconciliation.healthy IS DISTINCT FROM TRUE
        OR latest_reconciliation.chain_id <> operation.chain_id
        OR latest_reconciliation.eligible_reserve_minor_units <
            latest_reconciliation.liability_minor_units
            + (pending_issuance + NEW.amount_token_units) * minor_units_per_token THEN
        RAISE EXCEPTION 'issuance must match an authorized mint and confirmed deposit';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER issuance_valid_transition
    BEFORE INSERT OR UPDATE ON issuance_operations
    FOR EACH ROW EXECUTE FUNCTION validate_issuance_transition();

CREATE FUNCTION validate_redemption_amount() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
    minor_units_per_token BIGINT;
BEGIN
    SELECT fiat_minor_units_per_base_unit INTO minor_units_per_token
      FROM issuer_assets WHERE asset_code = NEW.asset_code;
    IF minor_units_per_token IS NULL
        OR NEW.payout_amount_minor_units <>
            NEW.amount_token_units * minor_units_per_token THEN
        RAISE EXCEPTION 'redemption payout amount does not match asset denomination';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER redemptions_exact_denomination
    BEFORE INSERT ON redemptions
    FOR EACH ROW EXECUTE FUNCTION validate_redemption_amount();

CREATE TABLE admin_roles (
    principal_id TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('reserve_reader', 'issuer_operator', 'treasury_approver', 'auditor')),
    enabled BOOLEAN NOT NULL DEFAULT FALSE,
    granted_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (principal_id, role)
);

CREATE TABLE audit_events (
    sequence BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    event_id UUID NOT NULL UNIQUE,
    actor_id TEXT NOT NULL,
    action TEXT NOT NULL,
    asset_code TEXT REFERENCES issuer_assets(asset_code),
    object_type TEXT NOT NULL,
    object_id TEXT NOT NULL,
    evidence_sha256 BYTEA CHECK (evidence_sha256 IS NULL OR octet_length(evidence_sha256) = 32),
    previous_event_sha256 BYTEA CHECK (
        previous_event_sha256 IS NULL OR octet_length(previous_event_sha256) = 32
    ),
    event_sha256 BYTEA NOT NULL CHECK (octet_length(event_sha256) = 32),
    occurred_at TIMESTAMPTZ NOT NULL,
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE audit_chain_head (
    singleton BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton),
    last_event_sha256 BYTEA CHECK (
        last_event_sha256 IS NULL OR octet_length(last_event_sha256) = 32
    ),
    event_count BIGINT NOT NULL DEFAULT 0 CHECK (event_count >= 0),
    CHECK ((event_count = 0) = (last_event_sha256 IS NULL))
);

INSERT INTO audit_chain_head (singleton, last_event_sha256, event_count)
VALUES (TRUE, NULL, 0);

CREATE FUNCTION reject_audit_event_mutation() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
    RAISE EXCEPTION 'ledger evidence rows are append-only';
END;
$$;

CREATE FUNCTION enforce_audit_chain_link() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
    current_hash BYTEA;
    current_count BIGINT;
BEGIN
    SELECT last_event_sha256, event_count
      INTO current_hash, current_count
      FROM public.audit_chain_head
     WHERE singleton = TRUE
     FOR UPDATE;

    IF current_count = 0 THEN
        IF NEW.previous_event_sha256 IS NOT NULL THEN
            RAISE EXCEPTION 'first audit event must not have a previous hash';
        END IF;
    ELSIF NEW.previous_event_sha256 IS DISTINCT FROM current_hash THEN
        RAISE EXCEPTION 'audit event does not extend the current hash chain';
    END IF;

    UPDATE public.audit_chain_head
       SET last_event_sha256 = NEW.event_sha256,
           event_count = current_count + 1
     WHERE singleton = TRUE;
    RETURN NEW;
END;
$$;

REVOKE ALL ON TABLE audit_chain_head FROM PUBLIC;
REVOKE ALL ON FUNCTION enforce_audit_chain_link() FROM PUBLIC;

CREATE TRIGGER audit_events_chain_link
    BEFORE INSERT ON audit_events
    FOR EACH ROW EXECUTE FUNCTION enforce_audit_chain_link();

CREATE TRIGGER audit_events_no_update
    BEFORE UPDATE OR DELETE ON audit_events
    FOR EACH ROW EXECUTE FUNCTION reject_audit_event_mutation();

CREATE TRIGGER audit_events_no_truncate
    BEFORE TRUNCATE ON audit_events
    FOR EACH STATEMENT EXECUTE FUNCTION reject_audit_event_mutation();

CREATE TRIGGER reserve_entries_no_update
    BEFORE UPDATE OR DELETE ON reserve_entries
    FOR EACH ROW EXECUTE FUNCTION reject_audit_event_mutation();

CREATE TRIGGER reserve_entries_no_truncate
    BEFORE TRUNCATE ON reserve_entries
    FOR EACH STATEMENT EXECUTE FUNCTION reject_audit_event_mutation();

CREATE TRIGGER treasury_approvals_no_update
    BEFORE UPDATE OR DELETE ON treasury_approvals
    FOR EACH ROW EXECUTE FUNCTION reject_audit_event_mutation();

CREATE TRIGGER treasury_approvals_no_truncate
    BEFORE TRUNCATE ON treasury_approvals
    FOR EACH STATEMENT EXECUTE FUNCTION reject_audit_event_mutation();

CREATE TRIGGER chain_supply_observations_no_update
    BEFORE UPDATE OR DELETE ON chain_supply_observations
    FOR EACH ROW EXECUTE FUNCTION reject_audit_event_mutation();

CREATE TRIGGER chain_supply_observations_no_truncate
    BEFORE TRUNCATE ON chain_supply_observations
    FOR EACH STATEMENT EXECUTE FUNCTION reject_audit_event_mutation();

CREATE TRIGGER reconciliation_runs_no_update_delete
    BEFORE UPDATE OR DELETE ON reconciliation_runs
    FOR EACH ROW EXECUTE FUNCTION reject_audit_event_mutation();

CREATE TRIGGER reconciliation_runs_no_truncate
    BEFORE TRUNCATE ON reconciliation_runs
    FOR EACH STATEMENT EXECUTE FUNCTION reject_audit_event_mutation();

CREATE TRIGGER treasury_operations_no_delete
    BEFORE DELETE OR TRUNCATE ON treasury_operations
    FOR EACH STATEMENT EXECUTE FUNCTION reject_audit_event_mutation();

CREATE TRIGGER issuance_operations_no_delete
    BEFORE DELETE OR TRUNCATE ON issuance_operations
    FOR EACH STATEMENT EXECUTE FUNCTION reject_audit_event_mutation();

CREATE TRIGGER redemptions_no_delete
    BEFORE DELETE OR TRUNCATE ON redemptions
    FOR EACH STATEMENT EXECUTE FUNCTION reject_audit_event_mutation();

CREATE FUNCTION validate_redemption_creation() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
    IF NEW.status <> 'pending'
        OR NEW.lock_transaction_hash IS NOT NULL
        OR NEW.payout_transaction_reference IS NOT NULL
        OR NEW.payout_event_id IS NOT NULL
        OR NEW.burn_transaction_hash IS NOT NULL
        OR NEW.release_transaction_hash IS NOT NULL THEN
        RAISE EXCEPTION 'new redemptions must begin pending without settlement evidence';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER redemptions_require_pending_creation
    BEFORE INSERT ON redemptions
    FOR EACH ROW EXECUTE FUNCTION validate_redemption_creation();

CREATE TRIGGER bank_events_no_delete
    BEFORE DELETE OR TRUNCATE ON bank_events
    FOR EACH STATEMENT EXECUTE FUNCTION reject_audit_event_mutation();

CREATE FUNCTION validate_bank_event_transition() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
BEGIN
    IF OLD.status <> 'received' OR NEW.status NOT IN ('confirmed', 'rejected') THEN
        RAISE EXCEPTION 'invalid bank event state transition';
    END IF;
    IF NEW.event_id <> OLD.event_id
        OR NEW.event_type <> OLD.event_type
        OR NEW.account_id <> OLD.account_id
        OR NEW.transaction_reference <> OLD.transaction_reference
        OR NEW.asset_code <> OLD.asset_code
        OR NEW.amount_minor_units <> OLD.amount_minor_units
        OR NEW.payload_sha256 <> OLD.payload_sha256
        OR NEW.created_at <> OLD.created_at THEN
        RAISE EXCEPTION 'bank event identity and evidence are immutable';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER bank_events_valid_transition
    BEFORE UPDATE ON bank_events
    FOR EACH ROW EXECUTE FUNCTION validate_bank_event_transition();

CREATE FUNCTION validate_reserve_entry_source() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
    source_event bank_events%ROWTYPE;
    expected_type TEXT;
BEGIN
    SELECT * INTO source_event
      FROM bank_events
     WHERE event_id = NEW.bank_event_id;
    IF NOT FOUND OR source_event.status <> 'confirmed' THEN
        RAISE EXCEPTION 'reserve entries require a confirmed bank event';
    END IF;
    expected_type := CASE NEW.entry_type
        WHEN 'deposit' THEN 'deposit'
        WHEN 'settled_redemption' THEN 'payout'
    END;
    IF source_event.event_type <> expected_type
        OR source_event.asset_code <> NEW.asset_code
        OR source_event.amount_minor_units <> NEW.amount_minor_units
        OR source_event.transaction_reference <> NEW.bank_transaction_reference THEN
        RAISE EXCEPTION 'reserve entry does not match its confirmed bank event';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER reserve_entries_verified_source
    BEFORE INSERT ON reserve_entries
    FOR EACH ROW EXECUTE FUNCTION validate_reserve_entry_source();

CREATE FUNCTION validate_redemption_transition() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public, pg_temp AS $$
DECLARE
    payout_event bank_events%ROWTYPE;
BEGIN
    IF NOT (
        (OLD.status = 'pending' AND NEW.status IN ('tokens_locked', 'failed'))
        OR (OLD.status = 'tokens_locked' AND NEW.status = 'payout_pending')
        OR (OLD.status = 'payout_pending' AND NEW.status IN ('payout_confirmed', 'payout_failed'))
        OR (OLD.status = 'payout_failed' AND NEW.status = 'tokens_released')
        OR (OLD.status = 'payout_confirmed' AND NEW.status = 'burned')
    ) THEN
        RAISE EXCEPTION 'invalid redemption state transition';
    END IF;
    IF NEW.redemption_id <> OLD.redemption_id
        OR NEW.asset_code <> OLD.asset_code
        OR NEW.requester_address <> OLD.requester_address
        OR NEW.request_idempotency_key <> OLD.request_idempotency_key
        OR NEW.payout_reference_hash IS DISTINCT FROM OLD.payout_reference_hash
        OR NEW.amount_token_units <> OLD.amount_token_units
        OR NEW.payout_amount_minor_units <> OLD.payout_amount_minor_units
        OR NEW.created_at <> OLD.created_at THEN
        RAISE EXCEPTION 'redemption identity and amount are immutable';
    END IF;
    IF (OLD.lock_transaction_hash IS NOT NULL AND NEW.lock_transaction_hash IS DISTINCT FROM OLD.lock_transaction_hash)
        OR (OLD.payout_transaction_reference IS NOT NULL AND NEW.payout_transaction_reference IS DISTINCT FROM OLD.payout_transaction_reference)
        OR (OLD.payout_event_id IS NOT NULL AND NEW.payout_event_id IS DISTINCT FROM OLD.payout_event_id)
        OR (OLD.burn_transaction_hash IS NOT NULL AND NEW.burn_transaction_hash IS DISTINCT FROM OLD.burn_transaction_hash)
        OR (OLD.release_transaction_hash IS NOT NULL AND NEW.release_transaction_hash IS DISTINCT FROM OLD.release_transaction_hash) THEN
        RAISE EXCEPTION 'redemption settlement evidence is immutable';
    END IF;
    IF NEW.status = 'tokens_locked' AND NEW.lock_transaction_hash IS NULL THEN
        RAISE EXCEPTION 'confirmed chain lock is required';
    ELSIF NEW.status IN ('payout_pending', 'payout_confirmed', 'payout_failed',
        'tokens_released', 'burned')
        AND (NEW.lock_transaction_hash IS NULL OR NEW.payout_transaction_reference IS NULL) THEN
        RAISE EXCEPTION 'chain lock and payout reference are required';
    END IF;
    IF NEW.status IN ('payout_confirmed', 'burned') THEN
        IF NEW.payout_event_id IS NULL THEN
            RAISE EXCEPTION 'confirmed payout bank event is required';
        END IF;
        SELECT * INTO payout_event
          FROM bank_events
         WHERE event_id = NEW.payout_event_id;
        IF NOT FOUND OR payout_event.status <> 'confirmed'
            OR payout_event.event_type <> 'payout'
            OR payout_event.asset_code <> NEW.asset_code
            OR payout_event.amount_minor_units <> NEW.payout_amount_minor_units
            OR payout_event.transaction_reference <> NEW.payout_transaction_reference THEN
            RAISE EXCEPTION 'redemption does not match confirmed payout event';
        END IF;
    ELSIF NEW.status IN ('payout_failed', 'tokens_released') THEN
        IF NEW.payout_event_id IS NULL THEN
            RAISE EXCEPTION 'confirmed payout failure bank event is required';
        END IF;
        SELECT * INTO payout_event
          FROM bank_events
         WHERE event_id = NEW.payout_event_id;
        IF NOT FOUND OR payout_event.status <> 'rejected'
            OR payout_event.event_type <> 'payout'
            OR payout_event.asset_code <> NEW.asset_code
            OR payout_event.amount_minor_units <> NEW.payout_amount_minor_units
            OR payout_event.transaction_reference <> NEW.payout_transaction_reference THEN
            RAISE EXCEPTION 'redemption does not match confirmed payout failure event';
        END IF;
    END IF;
    IF NEW.status = 'burned' AND NEW.burn_transaction_hash IS NULL THEN
        RAISE EXCEPTION 'confirmed chain burn is required';
    END IF;
    IF NEW.status = 'tokens_released' AND NEW.release_transaction_hash IS NULL THEN
        RAISE EXCEPTION 'confirmed chain lock release is required';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER redemptions_valid_transition
    BEFORE UPDATE ON redemptions
    FOR EACH ROW EXECUTE FUNCTION validate_redemption_transition();

CREATE VIEW current_reserve_ledger AS
WITH confirmed AS (
    SELECT
        asset_code,
        COALESCE(SUM(
            CASE
                WHEN entry_type = 'deposit' THEN amount_minor_units
                WHEN entry_type = 'settled_redemption' THEN -amount_minor_units
            END
        ), 0)::NUMERIC(78, 0) AS confirmed_reserve_minor_units
    FROM reserve_entries
    GROUP BY asset_code
),
pending_payouts AS (
    SELECT
        asset_code,
        COALESCE(SUM(payout_amount_minor_units), 0)::NUMERIC(78, 0)
            AS reserved_payout_minor_units
    FROM redemptions
    WHERE status = 'payout_pending'
    GROUP BY asset_code
),
pending_deposits AS (
    SELECT
        asset_code,
        COALESCE(SUM(amount_minor_units), 0)::NUMERIC(78, 0)
            AS pending_deposit_minor_units
    FROM bank_events
    WHERE status = 'received' AND event_type = 'deposit'
    GROUP BY asset_code
),
latest_reconciliation AS (
    SELECT DISTINCT ON (asset_code)
        asset_code,
        restricted_reserve_minor_units,
        eligible_reserve_minor_units,
        healthy,
        reconciled_at
    FROM reconciliation_runs
    ORDER BY asset_code, reconciled_at DESC, reconciliation_id DESC
)
SELECT
    a.asset_code,
    a.fiat_currency,
    COALESCE(c.confirmed_reserve_minor_units, 0)::NUMERIC(78, 0)
        AS confirmed_reserve_minor_units,
    COALESCE(p.reserved_payout_minor_units, 0)::NUMERIC(78, 0)
        AS reserved_payout_minor_units,
    r.restricted_reserve_minor_units,
    CASE WHEN r.healthy THEN r.eligible_reserve_minor_units END
        AS eligible_reserve_minor_units,
    COALESCE(r.healthy, FALSE) AS reconciliation_healthy,
    r.reconciled_at,
    COALESCE(d.pending_deposit_minor_units, 0)::NUMERIC(78, 0)
        AS pending_deposit_minor_units
FROM issuer_assets a
LEFT JOIN confirmed c ON c.asset_code = a.asset_code
LEFT JOIN pending_payouts p ON p.asset_code = a.asset_code
LEFT JOIN pending_deposits d ON d.asset_code = a.asset_code
LEFT JOIN latest_reconciliation r ON r.asset_code = a.asset_code;
