# SQM production readiness and source audit

**Audit date:** 2026-10-31  
**Status:** Development/testnet scaffold only. Production launch and all
cash-backed issuance are blocked.

## Scope and identity

The available blockchain source is the `scoin` tree. It builds a Cosmos SDK
application named `scoin`, with the `scoin` Bech32 prefix. No SQM chain identity,
separate SQM denomination, production genesis file, production deployment
configuration, or public mainnet is present in this repository. The native
monetary settings and denomination have intentionally not been changed.

## Required native monetary-policy status

- **STATUS: UNDECIDED — FORMAL APPROVAL REQUIRED.**
- **MAXIMUM SUPPLY: NOT YET DEFINED.**
- **GENESIS ALLOCATIONS: NOT YET APPROVED.**
- **FUTURE ISSUANCE: CURRENT SOURCE ENABLES COSMOS SDK INFLATION; FINAL POLICY NOT APPROVED.**
- No founder allocation or founder wallet allocation is approved.
- No local development or testnet balance is a production allocation.

## Monetary-policy audit

| Item | Finding |
|---|---|
| Cosmos SDK | `github.com/cosmos/cosmos-sdk v0.53.6` in `go.mod`; CometBFT `v0.38.21`; IBC-Go `v10.4.0`. |
| Native denomination | `uscoin` base denomination. `cmd/scoind/cmd/commands.go` registers `scoin` as the display denomination with exponent 6 (`1 scoin = 1,000,000 uscoin`). `app/config.go` sets the SDK default bond denomination to `uscoin`. The source does not define a separate `SQM` denomination. |
| Genesis file / total supply | No generated `genesis.json` or production genesis state is committed, so an actual on-chain total supply cannot be calculated from this repository. The development `config.yml` lists account balances of `200,000,000 uscoin` for `alice` and `100,000,000 uscoin` for `bob` (300,000,000 uscoin in those account entries), plus validator bond entries of 100,000,000, 200,000,000, and 100,000,000 uscoin. Those bond entries are configuration instructions, not additional supply to sum blindly with account balances. The faucet entry is `100,000 uscoin` for `bob`; it is not evidence of an additional independent allocation. These are development settings, not production allocations. |
| Live testnet supply | Not verified during this audit: the local REST API at `127.0.0.1:1317` refused the connection. No claim is made about current live testnet supply or balances. |
| Mint module | Enabled and included in the begin-blocker order in `app/app_config.go`. Its module account has the Cosmos SDK `Minter` permission. Minting uses the SDK mint module; there is no application-level supply-cap check. |
| Current default mint parameters | SDK `v0.53.6` `mint/types.DefaultParams`: mint denom is the SDK default bond denomination (`uscoin` in this app); `InflationRateChange = 13%`; `InflationMax = 20%`; `InflationMin = 7%`; `GoalBonded = 67%`; `BlocksPerYear = 6,311,520` (5-second-block assumption). These are SDK defaults, not an approved SQM policy. They set an inflation range and dynamic adjustment, not a maximum token supply. |
| Mint-parameter authority | No mint authority override is configured in `app/app_config.go`. Cosmos SDK v0.53.6's mint module defaults this authority to the `gov` module account. The mint `MsgUpdateParams` handler accepts updates signed by that authority, subject to the SDK parameter validation. Governance can therefore change mint parameters through an authorized governance execution. |
| Governance / software upgrades | The governance and upgrade modules are enabled. Governance authority can change mint parameters and can authorize module messages. The upgrade module is prioritized in pre-block execution; a coordinated software upgrade can change application code and issuance behavior. No code-level supply invariant survives arbitrary authorized software upgrades. |
| Modules with mint/burn permissions | `mint` has `Minter`; `ibc-transfer` has both `Minter` and `Burner` for IBC voucher accounting; staking bonded and not-bonded pool accounts and `gov` have `Burner`. The IBC transfer capability is for IBC denomination accounting and is not a bank-reserve-backed SQM issuance mechanism. Ordinary users do not receive module mint permissions. |
| Custom `x/scoin` module | The module currently contains scaffolded parameters and query/update plumbing; it does not implement a monetary cap, native mint/burn logic, reserve accounting, or SQM-UGX/SQM-USD assets. |
| Enforceable maximum supply | **No.** There is no hard cap or invariant preventing native `uscoin` supply from increasing through the enabled mint module. This audit does not add one or change mint behavior. |

The source/configuration references are [`go.mod`](../go.mod),
[`app/config.go`](../app/config.go), [`app/app_config.go`](../app/app_config.go),
[`cmd/scoind/cmd/commands.go`](../cmd/scoind/cmd/commands.go),
[`config.yml`](../config.yml), and the Cosmos SDK v0.53.6 mint module defaults.

## Existing chain, wallet, and service architecture

- **Blockchain:** Cosmos SDK application using CometBFT, with bank, mint,
  staking, distribution, governance, upgrade, and IBC modules. The generated
  local multi-validator setup is a development network, not a public mainnet.
- **Android/mobile:** `client/` is an Expo React Native project. It currently
  provides read-only chain/account/validator views. It does not generate or
  store a wallet key, sign transactions, send funds, or submit redemptions.
  There is no checked-in native `android/` project.
- **API:** the client has a localhost-only, GET-only development proxy. There
  is no issuer API, bank adapter, signed bank webhook endpoint, or production
  RPC configuration. The isolated `issuer/` module contains provider-neutral
  banking/custody interfaces and a webhook verifier, not a deployed endpoint
  or partner integration.
- **Database/explorer:** no production application database, reserve-ledger
  deployment, production explorer, or applied migration exists. `issuer/`
  contains a PostgreSQL repository, checksum-tracked migration runner,
  reserve-dashboard reader, atomic persistence for independently confirmed
  bank deposits and payouts, and append-only audit writes. These components
  are not wired into a service or production authentication, and the migration
  has not been run against PostgreSQL. The client reads a node's public Cosmos
  REST API.
- **EVM/MetaMask:** no EVM application module or MetaMask integration is
  configured. A transitive `go-ethereum` entry in `go.sum` is not evidence of
  EVM compatibility.
- **Banking/custody:** no bank or custodian is named or configured; no
  production credentials, bank accounts, custody agreements, verified
  deposits, payouts, or bank-confirmed reserve balances are present. No reserve
  balance is claimed.
- **Security/keys:** there is no issuer administration service, treasury
  signing configuration wired to a service, personal wallet key storage,
  bank-secret management, or bank webhook endpoint in the client or chain
  source. The separate `issuer/` module now has provider-neutral policy
  foundations, but no production security provider or live adapter.

## Production launch gate — BLOCKED

Do not launch a public mainnet or enable cash-backed issuance/redemption until
all applicable items below are independently verified and formally approved.
The current repository has no production deployment command or production
infrastructure; its release workflow publishes prereleases and does not deploy
a chain. This checklist is a blocking release requirement, not evidence that
any approval has been obtained.

1. **Native monetary policy:** formally approve the denomination, maximum
   supply if any, complete genesis allocations, future issuance/reward rules,
   governance controls, and upgrade policy. Implement and independently test
   the approved policy before describing a cap or launching.
2. **Uganda legal/regulatory clearance:** obtain a written Uganda-qualified
   legal assessment of the issuer, redeemable digital-money and payment
   services model, custody and redemption model, any applicable virtual-asset
   activities, AML/CFT and customer due diligence, consumer disclosures,
   personal-data handling, and UGX/USD and cross-border payment obligations.
   Counsel should determine applicability of Uganda's National Payment Systems
   Act and regulations, electronic-money requirements, Anti-Money Laundering
   Act/FIA obligations, data-protection law, and any virtual-asset framework;
   this repository does not determine that applicability. Confirm required
   licenses, regulator approvals and reporting directly with competent
   Ugandan authorities, including the Bank of Uganda and Financial
   Intelligence Authority where applicable. The codebase does not establish
   authorization, and this checklist is not legal advice.
3. **Bank and custody:** execute agreements with approved institutions for
   separate UGX and USD reserves; obtain production API credentials, approved
   webhook/signature specifications, settlement and reversal rules, and
   independent bank/custodian confirmation procedures. No partner or
   credentials are configured.
4. **Reserve controls:** the standalone `issuer/` module contains integer-safe
   coverage/reconciliation policy and a PostgreSQL repository/schema with
   separate asset dimensions, confirmed-only reserve entries, restricted
   reserve accounting in reconciliation snapshots, idempotency constraints,
   and append-only evidence controls. The repository has TLS-verified
   connection checks, a checksum-tracked transactional migration runner,
   reserve-dashboard reads, append-only audit writes, and deposit/payout paths
   that require verified webhooks and matching bank-adapter queries before
   atomically recording reserve entries and payout state. There is no concrete
   banking/custody adapter, application service, database instance, automated
   reconciliation job, or production authentication; the SQL has not been
   validated against PostgreSQL. Independent bank, custodian, and on-chain
   observations are not configured. These foundations are not operational
   reserve controls.
5. **Issuer and wallet security:** define issuer RBAC, strong admin
   authentication, independently reviewed multisig custody, secret management,
   monitoring/incident response, personal-wallet signing and recovery, and
   independent security audits. No such production system is configured.
6. **Network operations:** define and test production chain/genesis settings,
   validator independence, RPC/API access control, monitoring, backups,
   upgrades, incident response, and public explorer infrastructure. The local
   testnet and development API are not production infrastructure.
7. **Release authorization:** require documented approval from the legal,
   banking/custody, security, and chain-governance owners before establishing
   production genesis or enabling issuance/redemption. No such approvals are
   recorded here.

## Remaining implementation checklist

- [ ] Run `issuer/migrations/0001_init.sql` through `PostgresStore.RunMigrations`
  on a dedicated PostgreSQL instance; pass migration re-run, constraint,
  rollback, least-privilege, backup, and recovery checks. The current
  integration test is skipped unless `ISSUER_TEST_DATABASE_URL` is configured.
- [ ] Build and deploy an issuer API/service with strong authentication, RBAC,
  rate limiting, secure secret management, and least-privilege database roles.
- [ ] Implement a reconciliation worker that obtains independently verified
  bank, custodian, and latest on-chain supply observations, persists immutable
  runs, suspends issuance on any mismatch, and alerts operators.
- [ ] Implement provider-specific UGX and USD bank/custody adapters only after
  approved partner documentation, agreements, and production credentials are
  available. Cover statements, confirmations, payout, reversal, and failure
  evidence; none is configured now.
- [ ] Implement separate Cosmos SDK SQM-UGX/SQM-USD assets, genesis and upgrade
  handling, issuer permissions, guarded mint/burn, and module tests without
  changing native `uscoin` monetary policy.
- [ ] Wire deposit authorization/multisig, reserve coverage checks, and
  confirmed-deposit persistence to genuine on-chain issuance. Keep all
  issuance disabled until the external launch approvals are verified.
- [ ] Complete redemption request creation, chain token locking, approved
  payout submission, confirmed payout persistence, burn, and verified failure
  / lock-release handling. Only payout confirmation persistence exists in the
  database repository; no payout submission or on-chain settlement exists.
- [ ] Implement personal Cosmos wallet generation, encrypted recovery and
  device security, transaction signing/broadcast, actual balances, transfers,
  and transaction history without treasury access to user keys.
- [ ] Complete Android screens and verify a signed production build artifact.
- [ ] Verify Cosmos EVM compatibility, then implement and test MetaMask
  connection, signing, balances, and chain configuration only if supported.
- [ ] Prepare independent production validators, seed nodes, public RPC/REST,
  monitoring, backup/recovery, and a real explorer; the local validator network
  is not mainnet.
- [ ] Wire the issuer dashboard to production authentication and secure
  database access; add verified treasury workflows and audit views.
- [ ] Run PostgreSQL integration, chain-module, Android/web, end-to-end,
  race/fuzz, and independent security tests in supported environments.
- [ ] Obtain Uganda legal/regulatory clearance, bank/custody agreements,
  separately funded and verified UGX/USD reserves, signer controls, security
  assessment, and documented launch authorization before enabling redeemable
  issuance or deploying mainnet.

## Operational status

| Capability | Status |
|---|---|
| Local development chain scaffold | Present; not a public mainnet. |
| Native denomination metadata and SDK minting | Present as described above; policy remains undecided. |
| Native maximum supply enforcement | Absent. |
| SQM-UGX / SQM-USD tokens | Provisional specs (`sqmugx`: 0 decimals; `sqmusd`: 2 decimals); not registered or issued. |
| UGX/USD bank-confirmed reserves | Not configured or verified; no funds claimed. |
| Deposits, reconciliations, and redemptions | Policy foundations/tests only; no live integration or transaction service. |
| Production Android wallet or founder allocation | Not implemented or approved; Expo client remains read-only. |
| Issuer dashboard, database, and migration | PostgreSQL repository and dashboard reader implemented; no live database, executed migration, production service, or authentication. |
| EVM/MetaMask, public RPC, production explorer | Not configured. |
| Production launch | **Blocked.** |

Do not treat changing a status in this document as approval or as a substitute
for implementation, legal clearance, signed banking/custody agreements, or
independent verification.
