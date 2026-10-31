# MERIDIAN — real exchange establishment programme

**Working name:** MERIDIAN (subject to legal name and trademark clearance)  
**Proposed first jurisdiction:** Uganda  
**Expansion ambition:** East Africa, wider Africa, then international markets  
**Current technical status:** Real issuer-application and review workflow in development; no securities-exchange authorisation recorded  
**Current trading status:** Not enabled. No securities are listed or traded by this service.

## 1. Company thesis

MERIDIAN is intended to become a regulated securities-market operator specialising initially in capital formation for infrastructure and productive-economy businesses. The institution would provide issuer admission, disclosure, authorised-participant access, trading, market surveillance, market data and post-trade connectivity.

The intended product is not an investment app pretending to be an exchange. It is a market operator with a technology platform, governance, market rules, regulatory permission, authorised participants and approved settlement infrastructure.

## 2. Real first product in S-coin

The first implementation is the exchange operator's real issuer application and review service:
- authenticated company representatives submit actual issuer and company-registration details;
- each application receives a durable database record;
- the company begins as pending registration verification;
- authorised staff progress the application through review, information requests, due diligence or decline;
- the system records who took each action, their verified role, the previous and resulting status, the reason and the time;
- applicant access is limited to the applicant's own record;
- staff queues and review actions require identity-provider roles;
- data is persisted in PostgreSQL and audit/event records are append-only at the database-trigger level.

This first workflow does not represent a listing decision. Issuer documents, registry checks, financial due diligence, prospectus/offer approvals and listing admission are separate workflows to be implemented after document storage, qualified professionals and regulator requirements are agreed.

## 3. Regulatory path in Uganda

The starting regulator is the Uganda Capital Markets Authority (CMA). The current published framework includes the Capital Markets Authority (Licensing and Approval) Regulations, 2025 (Statutory Instrument No. 5 of 2025).

The 2025 regulations require an exchange applicant to provide evidence relating to minimum paid-up and working capital as prescribed by CMA, exchange rules and constitutional documents, details of the proposed trading system, and a comprehensive business plan for developing the market. The regulations also require governance, suitable expertise and infrastructure.

The approved exchange's trading-system requirements include bids/offers visible to each other, a transparent pricing mechanism, automatic matching, efficient liquidity distribution, high/low prices, latest transactions and volumes, transaction audit trails and trace-back, access controls, retained transaction records, and connectivity to a securities central depository.

The rules also require a network of trading participants with adequate financial, technological and administrative capacity, connectivity with those participants and the securities central depository, business continuity and disaster recovery, insurance, and board approval before a trading system is installed or implemented.

CMA's published licensed-firms register currently identifies the Uganda Securities Exchange and ALTX East Africa as stock exchanges and also lists the securities central depository operators. These existing institutions are potential infrastructure counterparties and competitors; a new entrant must establish a lawful and commercially differentiated route rather than assume it can bypass them.

Primary sources:
- CMA regulations portal: https://cmauganda.co.ug/regulations/
- CMA licensed firms: https://cmauganda.co.ug/cma-licensed-firms/
- Uganda Securities Exchange market regulations: https://www.use.or.ug/rules-and-regulations/market-regulations
- Uganda Capital Markets Authority: https://cmauganda.co.ug/

The exact capital thresholds, conditions, company structure, board composition, approval path, market rules and CSD arrangements must be confirmed in writing with CMA and Ugandan capital-markets counsel. No assumption in this document replaces that advice or a regulator decision.

## 4. Regulatory and operational sequence

1. Incorporate the intended exchange-operating company after counsel advises on the required corporate form and ownership restrictions.
2. Appoint qualified Ugandan capital-markets counsel and an experienced exchange executive/compliance lead.
3. Request a CMA pre-application meeting and obtain the current requirements for capital, ownership, directors, insurance, business plan, rules and application evidence.
4. Determine whether an existing approved CSD can provide services to a separately approved exchange and obtain its technical/commercial requirements.
5. Engage licensed brokers/dealers and understand what participant approval, access, client onboarding and capital requirements will apply.
6. Agree a clearing bank, depository, custodial and settlement operating model with regulated providers.
7. Build the full exchange rulebook, governance framework, surveillance and conduct framework, cybersecurity and operational resilience controls.
8. Submit the formal exchange application and obtain written approval and conditions.
9. Install and validate the approved trading system only after the required board and regulatory steps.
10. Commence trading only after CMA authorisation, participant onboarding, CSD connectivity, clearing/settlement readiness, operational tests and any launch permissions are satisfied.

## 5. Product architecture roadmap

### Current real subsystem
- OIDC-verified staff and applicant identity.
- Role-based access.
- Actual issuer application intake.
- Actual company registration particulars.
- Review and due-diligence status lifecycle.
- PostgreSQL persistence with TLS full verification.
- Append-only application and audit events.
- Regulatory-authorisation record visibility.
- Trading disabled.

### Next production workstreams
- managed document storage, checksum evidence, antivirus scanning and document access controls;
- organisation registry verification workflow and reviewer evidence;
- beneficial ownership, director, financial statements and legal due-diligence workflows under an approved privacy/retention framework;
- broker/dealer application, regulator licence verification and participant admission;
- securities depository, clearing bank, custody and settlement partner contracting and technical integration;
- CMA application evidence register and compliance obligations;
- approved listing rules, offer documents and issuer disclosure management;
- market surveillance and regulatory reporting;
- disaster recovery, independent security assurance, internal audit and operational controls.

### Trading system gate

The service intentionally exposes no order, matching, trade, client-cash, custody, clearing or settlement endpoint. A regulatory-authorisation record alone must never enable trading. Trading is a separate programme gate requiring the exchange approval, approved rules, qualified and admitted participants, CSD connectivity, clearing/settlement partners, market surveillance, tested operational resilience and any specific CMA launch approval. The current API reports \`tradingEnabled: false\` unconditionally.

## 6. Production trust and data controls

The code requires:
- HTTPS OIDC discovery and cryptographically verified ID tokens;
- identity-provider-issued roles (never roles supplied by request bodies);
- a verified identity-provider email matching the applicant email;
- PostgreSQL \`sslmode=verify-full\`;
- separately run database migrations and a least-privilege runtime database role;
- an HTTPS server with TLS 1.3 minimum;
- append-only application-event and audit-event tables.

Before actual company documents are stored, the company must configure a managed storage system, malware scanning, key management, encryption at rest, backups, retention and deletion rules, data-subject request procedures, a privacy notice and an independent security assessment.

## 7. Business model and validation

Potential revenue categories for a future approved operator include issuer admission and annual listing fees, participant access/connectivity charges, transaction charges, market-data licensing and approved corporate-action services. None is currently being charged.

Before raising major exchange-operator capital, secure written regulatory feasibility guidance, a bottom-up capital and operating budget, serious issuer interest, genuine investor and broker interest, and a credible CSD/clearing/settlement path.

The first commercial validation interviews should focus on actual issuers with a financing need, licensed brokers, institutional investors, banks, custodians and the two existing CSD/exchange ecosystems.

## 8. Current truth

This repository is a development codebase. It does not contain an incorporated exchange operator, approved board, verified capital, CMA approval, accepted listing, licensed trading participant contracts, production identity provider, deployed PostgreSQL database, depository agreement, clearing bank agreement, live order book or settlement connection.

MERIDIAN is not yet authorised to operate a securities exchange. No real securities trading can take place through this service.
