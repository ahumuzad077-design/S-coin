CREATE TABLE IF NOT EXISTS exchange_schema_migrations (
    version BIGINT PRIMARY KEY,
    checksum TEXT NOT NULL,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS exchange_organisations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    legal_name TEXT NOT NULL,
    registration_country CHAR(2) NOT NULL,
    registration_number TEXT NOT NULL,
    registered_address TEXT NOT NULL,
    website TEXT NOT NULL DEFAULT '',
    verification_status TEXT NOT NULL DEFAULT 'PENDING_VERIFICATION'
        CHECK (verification_status IN ('PENDING_VERIFICATION','VERIFIED','REJECTED')),
    registration_evidence_reference TEXT,
    registration_verified_by_subject TEXT,
    registration_verified_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (registration_country, registration_number)
);

CREATE TABLE IF NOT EXISTS exchange_issuer_applications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organisation_id UUID NOT NULL REFERENCES exchange_organisations(id),
    applicant_subject TEXT NOT NULL,
    applicant_organization_id TEXT NOT NULL,
    applicant_email TEXT NOT NULL,
    applicant_phone TEXT NOT NULL,
    proposed_security_type TEXT NOT NULL
        CHECK (proposed_security_type IN ('EQUITY','CORPORATE_BOND','INFRASTRUCTURE_BOND','GREEN_BOND','SUKUK','OTHER')),
    proposed_market_segment TEXT NOT NULL
        CHECK (proposed_market_segment IN ('MAIN','GROWTH','DEBT','INFRASTRUCTURE')),
    business_description TEXT NOT NULL,
    capital_seeking_minor BIGINT NOT NULL CHECK (capital_seeking_minor >= 0),
    currency CHAR(3) NOT NULL CHECK (currency IN ('UGX','USD','EUR','KES','TZS','RWF')),
    status TEXT NOT NULL DEFAULT 'SUBMITTED'
        CHECK (status IN ('SUBMITTED','UNDER_REVIEW','INFORMATION_REQUESTED','DUE_DILIGENCE','DECLINED')),
    assigned_to_subject TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS exchange_issuer_applications_status_created_idx
    ON exchange_issuer_applications(status, created_at DESC);
CREATE INDEX IF NOT EXISTS exchange_issuer_applications_applicant_idx
    ON exchange_issuer_applications(applicant_subject, created_at DESC);

CREATE TABLE IF NOT EXISTS exchange_issuer_application_events (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    application_id UUID NOT NULL REFERENCES exchange_issuer_applications(id),
    actor_subject TEXT NOT NULL,
    actor_role TEXT NOT NULL,
    event_type TEXT NOT NULL,
    previous_status TEXT,
    new_status TEXT,
    reason TEXT NOT NULL DEFAULT '',
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS exchange_issuer_application_events_application_idx
    ON exchange_issuer_application_events(application_id, occurred_at ASC, id ASC);

CREATE TABLE IF NOT EXISTS exchange_audit_events (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    actor_subject TEXT NOT NULL,
    actor_role TEXT NOT NULL,
    event_type TEXT NOT NULL,
    resource_type TEXT NOT NULL,
    resource_id TEXT NOT NULL,
    request_id TEXT NOT NULL DEFAULT '',
    occurred_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS exchange_audit_events_resource_idx
    ON exchange_audit_events(resource_type, resource_id, occurred_at DESC);

CREATE OR REPLACE FUNCTION exchange_reject_audit_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'exchange audit and application event records are append-only';
END;
$$;

DROP TRIGGER IF EXISTS exchange_issuer_events_immutable ON exchange_issuer_application_events;
CREATE TRIGGER exchange_issuer_events_immutable
    BEFORE UPDATE OR DELETE ON exchange_issuer_application_events
    FOR EACH ROW EXECUTE FUNCTION exchange_reject_audit_mutation();

DROP TRIGGER IF EXISTS exchange_audit_events_immutable ON exchange_audit_events;
CREATE TRIGGER exchange_audit_events_immutable
    BEFORE UPDATE OR DELETE ON exchange_audit_events
    FOR EACH ROW EXECUTE FUNCTION exchange_reject_audit_mutation();

CREATE TABLE IF NOT EXISTS exchange_regulatory_authorisations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    authority_name TEXT NOT NULL,
    authorisation_type TEXT NOT NULL,
    reference_number TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('PENDING_VERIFICATION','VERIFIED','SUSPENDED','REVOKED','EXPIRED')),
    effective_at TIMESTAMPTZ,
    expires_at TIMESTAMPTZ,
    evidence_reference TEXT NOT NULL,
    verified_by_subject TEXT,
    verified_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (authority_name, authorisation_type, reference_number),
    CHECK (
        (status <> 'VERIFIED')
        OR (verified_by_subject IS NOT NULL AND verified_at IS NOT NULL AND effective_at IS NOT NULL)
    )
);

CREATE INDEX IF NOT EXISTS exchange_regulatory_authorisations_status_idx
    ON exchange_regulatory_authorisations(authorisation_type, status, expires_at);
