# MERIDIAN exchange operations service

This is the first **real operating subsystem** for the proposed MERIDIAN securities exchange. It records actual issuer applications, company registration details, reviewer decisions and an append-only audit trail in PostgreSQL. It contains no seeded companies, synthetic prices, paper balances, order simulator or trade-execution endpoint.

## What this service does

- Accepts an authenticated company representative's issuer application.
- Requires a valid OIDC identity token and an identity-provider-verified email.
- Records the company's legal name, registration jurisdiction and registration number.
- Stores the proposed security type, market segment, business description, amount sought and currency.
- Allows an authorised exchange reviewer to start review, request information, progress to due diligence or decline an application.
- Allows an exchange compliance officer to verify or reject company registration against an HTTPS registry evidence reference; the reviewer identity, evidence URL and timestamp are recorded.
- Restricts applicants to their own records and restricts application queues/decisions to exchange staff roles.
- Writes application status events and audit events in the same database transaction as each decision.
- Protects application-event and audit-event rows against update/delete at the database trigger level.
- Reports whether a securities-exchange authorisation has been recorded, without enabling trading.

## What it does not do

This service does not list securities, approve offers, accept investments, open investor accounts, onboard licensed brokers, route orders, match trades, hold client money/securities, connect to a central securities depository, clear or settle transactions, or operate an exchange. There is deliberately no order/trade API and the exchange status endpoint always reports \`tradingEnabled: false\`.

An issuer's application is not a listing approval, prospectus approval, offer approval, regulator approval, or permission to trade. The company registration status begins as \`PENDING_VERIFICATION\`; the service does not claim that registry or financial information has been independently checked.

## Runtime requirements

- PostgreSQL with TLS configured.
- A PostgreSQL URL using \`sslmode=verify-full\` and an explicit trusted root certificate.
- An OIDC identity provider with HTTPS discovery and signing keys.
- OIDC client ID matching the issuer-applicant and exchange-staff application.
- Signed ID tokens with \`sub\`, \`email\`, \`email_verified\` and role/group claims.
- TLS certificate and private key for the HTTP service.
- A real legal operator name supplied through configuration; no operator company is invented in source.

Recognised role claims: \`ISSUER_APPLICANT\`, \`EXCHANGE_REVIEW_OFFICER\`, \`EXCHANGE_COMPLIANCE\`, \`EXCHANGE_ADMIN\`. Roles must be assigned in the identity provider by an authorised administrator. A user cannot grant themselves a role through a request body.

## Database setup

Use a separate migration database role for schema changes:

\`\`\`sh
cd exchange
export DATABASE_URL='postgresql://exchange_migrator:...@db.example:5432/meridian?sslmode=verify-full&sslrootcert=/run/secrets/postgres-ca.pem'
go run ./cmd/exchange-ops migrate
\`\`\`

Use a separate runtime database role for the service. It should have only the required SELECT/INSERT/UPDATE privileges on business tables, SELECT and INSERT on application/audit events, and SELECT on the migration table. It must not own the schema/tables, perform DDL, update/delete audit records, disable triggers or truncate event tables. The deployment DBA must grant and verify least-privilege permissions before starting the service.

## Start the HTTPS service

\`\`\`sh
export DATABASE_URL='postgresql://exchange_runtime:...@db.example:5432/meridian?sslmode=verify-full&sslrootcert=/run/secrets/postgres-ca.pem'
export OIDC_ISSUER_URL='https://identity.example.com/'
export OIDC_CLIENT_ID='meridian-exchange-operations'
export EXCHANGE_LEGAL_NAME='[insert the incorporated legal operator name]'
export EXCHANGE_TLS_CERT_FILE='/run/secrets/meridian-fullchain.pem'
export EXCHANGE_TLS_KEY_FILE='/run/secrets/meridian-private-key.pem'
export EXCHANGE_LISTEN_ADDR=':8443'
go run ./cmd/exchange-ops serve
\`\`\`

The placeholders must be replaced with real, approved infrastructure values. The service will refuse to start if database TLS verification, OIDC configuration, the legal operator name, TLS files or database migration are missing.

## API

All endpoints except \`GET /healthz\` require an OIDC bearer ID token.

- \`GET /healthz\` — service liveness.
- \`GET /v1/exchange/status\` — read-only regulatory-authorisation record; trading remains disabled.
- \`POST /v1/issuer-applications\` — create a real company application; requires \`ISSUER_APPLICANT\` and a verified email matching the applicant email.
- \`GET /v1/issuer-applications/{id}\` — read own application, or any application as an authorised exchange reviewer.
- \`GET /v1/issuer-applications/{id}/events\` — read application history with the same access rule.
- \`GET /v1/issuer-applications?status=...&limit=...\` — reviewer queue; requires reviewer, compliance or admin role.
- \`POST /v1/issuer-applications/{id}/decisions\` — authorised review decision with a recorded reason; requires reviewer, compliance or admin role.

Application statuses: \`SUBMITTED\`, \`UNDER_REVIEW\`, \`INFORMATION_REQUESTED\`, \`DUE_DILIGENCE\`, \`DECLINED\`. There is no \`LISTED\`, \`LIVE\`, \`APPROVED_FOR_TRADING\` or \`TRADED\` status in this intake workflow.

## Data protection and operational controls still required

Before storing actual company records, the operator must appoint accountable data-protection and security owners, publish a suitable privacy notice, establish a lawful basis and retention/deletion policy, configure database encryption at rest and key management, secure backups, implement network restrictions and monitoring, and perform an independent security review. Upload of incorporation records, accounts, beneficial-ownership records or prospectuses is not enabled until a managed document-storage and malware-scanning service is selected and configured.

This repository contains source code only. It does not provision a production database, identity provider, certificate authority, hosting environment, company registration verification, CMA authorisation, central depository connection or banking/settlement partner.

## Local quality checks

\`\`\`sh
go test ./...
go vet ./...
\`\`\`

Any integration test must use a dedicated disposable PostgreSQL database and must never point to production.
