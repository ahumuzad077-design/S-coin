# SQM issuer foundation

This directory is an isolated Go module for issuer-side policy foundations.
It does not replace the Cosmos SDK chain or change its native `uscoin`
denomination, inflation, genesis, or supply policy. SQM-UGX and SQM-USD are
provisional specifications only; they are not registered or issued on-chain.

## Asset units

| Asset | Proposed denom | Token precision | Backing unit |
|---|---|---:|---|
| SQM-UGX | `sqmugx` | 0 decimals | 1 base unit = UGX 1 |
| SQM-USD | `sqmusd` | 2 decimals | 1 base unit = USD 0.01; 100 base units = USD 1 |

These are technical placeholders, not approved denominations or legal
redemption promises. Cosmos token supplies, reserve liabilities, and bank
amounts are represented in integer base units/minor units; USD cents map
one-to-one to `sqmusd` base units. The migration seeds only these disabled
asset specifications and a disabled two-signer policy; it creates no reserve,
partner, account, signer, approval, or token balance.

## Local checks

From this directory, run:

```powershell
go test ./...
go vet ./...
```

The unit tests use isolated fixtures and do not send bank requests, write
reserve balances, issue tokens, or connect to a production chain.

## PostgreSQL repository and schema

The initial schema is `migrations/0001_init.sql`. `PostgresStore` provides
TLS-verified PostgreSQL connection management, a repeatable checksum-tracked
transactional migration runner, reserve dashboard reads, append-only audit
writes, and atomic persistence paths for signed deposit/payout webhooks plus
separately fetched matching bank confirmations. They require approved/enabled
reserve accounts, enforce idempotency through database constraints, and store
the bank event, reserve entry, redemption transition where applicable, and
audit event in one transaction. They do not submit transactions to a bank.
`OpenPostgres` rejects URLs without `sslmode=verify-full`.

```powershell
$env:ISSUER_TEST_DATABASE_URL = "<TLS-verified disposable test database URL>"
go test -v ./...
```

The integration test applies the migration to that database and
creates/rolls back a clearly named test partner fixture; do not point it at
production. This repository still has no issuer executable to consume an
`ISSUER_DATABASE_URL`. Call `OpenPostgres` and `RunMigrations` only from a
reviewed application bootstrap and use a separate migration role. The schema
migration is versioned and checksum-checked; it must still be reviewed and
backed up before operational use.

The database has not yet been validated against a live PostgreSQL server in
this environment. The migration role needs reviewed DDL privileges and must
be separate from the runtime role. The application role must not own the
schema or tables; grant only the minimum required privileges. Runtime roles
must not modify `audit_chain_head`, disable triggers, truncate evidence tables,
or perform DDL. A runtime role needs read-only access to `audit_chain_head` and
must not be granted direct writes there; audit append serialization uses a
PostgreSQL advisory lock and the trigger owns head updates. Back up the
database and exercise recovery before any operational use.
This schema is not a standalone security boundary: PostgreSQL does not verify
the Ed25519 approval signatures or independently validate the launch-gate
evidence. The trusted issuer service must verify signatures and evidence
before privileged state changes; that service and its database grants do not
exist here. The SQL audit trigger enforces chain linkage but does not calculate
the event digest; auditors must verify rows with `VerifyAuditChain`, and the
local chain still needs an independent external anchor.
The seeded launch-gate row is entirely disabled. The SQL schema adds an
issuance gate requiring the documented approval flags, a live authorized
treasury operation, a confirmed matching deposit, healthy reserve coverage,
and sufficient coverage after pending issuance reservations.
The reserve view reports eligible reserve as unknown unless the latest
reconciliation is healthy; restricted reserve balances are excluded from
coverage. Reconciliation snapshots require both bank and custodian
confirmation.

## Hard production boundary

`CanIssue` and `CanRedeem` always return `ErrProductionDisabled`. There is no issuer
executable, production bank/custodian adapter, payout service, verified launch-gate provider, or on-chain mint/burn implementation.
The reserve checks, multisignature authorization, and lock/payout/burn state
rules are policy code only; they do not submit transactions. A verified bank
payout failure is required before the state rules permit an authorized lock
release. The provider-neutral HMAC webhook verifier is not a bank integration
and must not be configured unless an approved partner documents that exact
signature protocol. It does not provide event deduplication without the
persistent uniqueness constraints.
`providers.go` defines bank and custodian adapter contracts only; it contains
no network client, endpoint, credential, or provider implementation.

The administration HTTP handler has no production authentication provider or
rate limiter wired in. `PostgresStore` now implements its database reader, but
the handler must not be exposed until strong authentication, RBAC, rate
limiting, least-privilege database grants, and independent review are in place.
The existing Expo app remains read-only: it does not generate, import, store,
recover, or sign with wallet keys. Do not enter a recovery phrase into it.

Before any real issuance or redemption, obtain and independently verify the
bank and custody agreements, actual cleared UGX/USD funding, regulator/legal
clearance, production RPC and chain support, tested payout/reversal procedures, admin identity and RBAC, signer custody and quorum
policy, audit controls, monitoring, and an independent security assessment.
The local audit hash chain is not independently tamper-proof; an external
anchor and independent verification process remain necessary. See
[`../docs/production-readiness.md`](../docs/production-readiness.md).
