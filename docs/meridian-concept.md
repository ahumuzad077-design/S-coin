# MERIDIAN — Exchange establishment concept

**Working name:** MERIDIAN  
**Proposed first jurisdiction:** Uganda, subject to legal and regulatory feasibility  
**Long-term geography:** East Africa → wider Africa → selected international markets  
**Current status:** Pre-licensing concept and closed software simulation  
**Repository implementation:** `exchange/` (Go simulation) and `client/src/MarketScreen.tsx` (Expo client)

## 1. Company thesis

MERIDIAN is a proposed digitally native securities-market operator focused initially on infrastructure and productive-economy securities. Its long-term objective is to make it easier for eligible issuers to raise long-term capital and for investors to access transparent, investable securities through a regulated market.

The initial product thesis is not "another stock-trading app". It is market infrastructure: issuer admission and disclosure processes, broker connectivity, order management and matching, market surveillance, market data, and interoperable post-trade workflows.

MERIDIAN is not currently an exchange, broker, investment adviser, custodian, central securities depository, clearing house, payment service, or authorised securities intermediary. No securities are listed and no live trading takes place.

## 2. Proposed initial market focus

The first segment to investigate is infrastructure and productive-economy securities, including eligible:
- infrastructure and project bonds;
- corporate bonds and other debt securities;
- growth-company equity;
- green or sustainability-linked instruments; and
- other securities approved by the regulator and admitted under the eventual market rules.

This segment is a hypothesis to validate with issuers, investors, brokers, depository operators and the regulator. It is not a decision to admit any particular security or asset-backed structure.

## 3. Market problem

African capital markets remain fragmented across jurisdictions, currencies, regulators, trading systems, custodians, depositories and settlement arrangements. New software alone cannot solve these institutional constraints.

MERIDIAN will need to prove that it can:
1. attract eligible issuers with a credible listing proposition;
2. bring genuine investors and licensed trading participants to the market;
3. create defensible and transparent price discovery;
4. support liquidity rather than merely create an electronic order book;
5. integrate with approved clearing, settlement and depository infrastructure; and
6. deliver reliable governance, surveillance, disclosure and investor protection.

## 4. Proposed differentiators

- A specialist issuer and securities segment focused on productive-economy and infrastructure capital.
- Structured issuer onboarding and comparable disclosure workflows.
- A transparent trading and market-data architecture.
- Liquidity design that may include scheduled call auctions for less liquid instruments, subject to regulator approval and market design.
- Cross-border connectivity through locally authorised participants and appropriate regulatory arrangements.
- Institutional-grade governance, surveillance, auditability, cybersecurity and operational resilience.

The African Exchanges Linkage Project, existing regional exchanges, and current domestic growth-market operators are relevant comparators. MERIDIAN should build on established market infrastructure where feasible and must not claim to be the first African cross-border market or the first growth-company exchange.

## 5. First product: MERIDIAN Exchange OS v0.1

The repository contains a closed simulation for software and market-design learning. It provides five fictional UGX securities, a paper investor account, a synthetic liquidity account, a limit order book, price/time priority matching, cash and share reservations, cancellation, a portfolio view, and a loopback-only HTTP API.

The simulation uses in-memory balances, orders and fills. It resets when the process stops. It is intended for developer demonstrations and controlled product experiments only.

### Explicit non-goals of v0.1

- No real issuers or securities.
- No investment offers, public solicitation, subscriptions or allocations.
- No real money, bank deposits, payments or withdrawals.
- No use of S Coin native balances or SQM-UGX/SQM-USD reserve assets.
- No user wallet signing, blockchain securities issuance or tokenisation.
- No live broker, exchange, custodian, CSD, clearing or settlement integration.
- No market-data feed from a live exchange.
- No internet-exposed API or production authentication.
- No representation that MERIDIAN is licensed, approved or operational.

## 6. Regulatory and legal feasibility workstream

Before any live market operation, Ugandan-qualified securities counsel must provide written advice and the company must obtain the necessary regulator guidance and permissions.

The first formal step is a pre-application discussion with the Uganda Capital Markets Authority (CMA). The discussion should seek written clarity on:
- the legal classification of the proposed business and activities;
- the applicable exchange approval and licensing route;
- current minimum paid-up and working capital requirements;
- ownership, fit-and-proper, board, independence and governance requirements;
- required exchange rules, listing and disclosure standards;
- market surveillance, complaints, enforcement and investor-protection obligations;
- technology, cybersecurity, audit, business-continuity and disaster-recovery requirements;
- whether an existing licensed central securities depository can service an independently operated exchange, and what approvals and contracts would be required;
- the roles of authorised brokers, custodians, banks, clearing agents and settlement institutions;
- regulatory sandbox eligibility, if applicable; and
- any requirements for foreign issuers, investors, currencies and cross-border access.

Primary starting points (not legal advice):
- Uganda Capital Markets Authority: https://cmauganda.co.ug/
- Uganda Securities Exchange: https://use.or.ug/
- ALTX East Africa: https://www.altxafrica.com/
- African Exchanges Linkage Project: https://africanexchangeslink.com/

The legal and regulatory workstream must use current primary law, regulations and written regulator guidance. Do not assume a domestic approval automatically permits activity in another country.

## 7. Production market-infrastructure architecture

A future regulated operator would need distinct, independently reviewed systems and controls:

1. **Issuer admission and disclosure:** applications, eligibility checks, due diligence, approved offering/listing documentation, periodic disclosures and corporate actions.
2. **Participant and access management:** onboarding, permissions and connectivity for appropriately licensed market participants.
3. **Order management and matching:** deterministic matching, price/time or other approved priority rules, session controls, order amendments, cancellations, halts and market states.
4. **Market surveillance:** controls for manipulation, insider dealing, suspicious patterns, cross-account activity, unusual orders and escalation.
5. **Market data:** authoritative trade and quote records, dissemination, corrections and audit history.
6. **Post-trade:** integration with approved clearing, CSD, custody, bank and settlement arrangements, with reconciliations and exception handling.
7. **Governance and oversight:** independent supervision, audit trails, complaints, enforcement and regulator reporting.
8. **Operational resilience:** identity and access controls, key management, penetration testing, independent audits, backups, recovery tests, incident response and secure change management.

A production matching engine is not sufficient on its own to make a functioning exchange. Legal, governance, participant, liquidity, CSD and settlement arrangements are equally critical.

## 8. Commercial validation gates

Before seeking substantial exchange-operator capital, complete the following validation:

- interview prospective issuers and document their actual capital needs, readiness, costs and willingness to list;
- interview institutional and retail investor representatives and determine eligible demand, risk appetite, currency requirements and ticket sizes;
- interview licensed brokers and understand participant economics and connectivity requirements;
- obtain technical and commercial discussions with CSD and post-trade operators;
- obtain written CMA guidance on feasibility and requirements;
- secure credible, non-binding expressions of interest from prospective issuer and investor partners without describing them as approved listings or committed capital;
- build a bottom-up operating-cost and regulatory-capital model using verified requirements; and
- commission independent market-structure, technology and cyber-risk reviews.

Only after those gates should the company finalise a launch budget and capital raise.

## 9. Development roadmap

| Phase | Deliverable | Gate |
|---|---|---|
| 0 | Closed simulator and product architecture | No real assets, accounts or trades |
| 1 | Issuer workflow, disclosure, admin and surveillance prototypes | Market design and user validation |
| 2 | Legal feasibility, regulator pre-application and CSD discovery | Written route and requirements |
| 3 | Production architecture and independent controls design | Board and professional sign-off |
| 4 | Licensing, capitalisation, participants and contractual integrations | All relevant approvals and operational readiness |
| 5 | Controlled launch of an authorised market | Formal regulator permission and launch approval |
| 6 | Cross-border expansion | Separate jurisdictional approvals and arrangements |

## 10. Founding principle

MERIDIAN must earn trust before it seeks to operate a market. Technology can demonstrate how a market might work; only the correct authorisation, governance, participants, investor protections and settlement arrangements can make it a legitimate securities market.
