# TODO — AI-First Customer Support for Shopify

> Generert fra [shopify_ai_customer_support_development_plan.md](shopify_ai_customer_support_development_plan.md).
> Følg fasene i rekkefølge. Ikke start en fase før forrige fases exit-kriterier er oppfylt (se §42–43).
> Hver enkeltfunksjon skal oppfylle **Definition of Done** (se bunnen av dokumentet) før den regnes som ferdig.

---

## Fase 0 — Foundation & Forarbeid

### 0.1 Repo-analyse og oppstartsdokumenter (§49)
- [x] Inspiser hele eksisterende repository (framework, dependencies, mønstre)
- [x] Verifiser gjeldende Shopify API/anbefalinger mot offisiell dokumentasjon
- [x] Opprett/oppdater `ARCHITECTURE.md`
- [x] Opprett/oppdater `ROADMAP.md`
- [x] Opprett/oppdater `SECURITY.md`
- [x] Opprett/oppdater `.env.example`
- [x] Foreslå endelig database-schema
- [x] Foreslå folder structure
- [x] Identifiser nødvendige secrets/environment variables
- [x] Lag konkret MVP-taskliste med avhengigheter
- [x] Identifiser arkitekturbeslutninger som må tas før implementering

### 0.2 Arkitekturbeslutninger (§3)
- [x] Bestem multi-tenancy-strategi (`shopId` på alle tenant-eide data, server-side verifisering)
- [x] Design separate modeller: `ShopifyInstallation`, `User`, `ShopMembership` (§3.2)
- [x] Design service layer-struktur: `TicketService`, `CustomerService`, `ShopifyContextService`, `KnowledgeService`, `EmailService`, `AIOrchestrator`, `AIValidationService`, `AssignmentService`, `AuthorizationService`, `NotificationService`, `AutomationEngine`, `AuditService`
- [x] Definer provider-abstraksjoner: `AIProvider`, `EmbeddingProvider`, `EmailProvider`, `StorageProvider`, `NotificationProvider`

### 0.3 Teknisk fundament (§4, §43)
- [x] Sett opp TypeScript (strict mode)
- [x] Sett opp Shopify React Router-app + App Bridge
- [x] Konfigurer Shopify Admin GraphQL API-tilgang
- [x] Sett opp PostgreSQL + Prisma ORM
- [x] Sett opp pgvector (eller tilsvarende) for vector store
- [x] Sett opp background job queue
- [x] Sett opp objektlagring for vedlegg/dokumenter
- [x] Sett opp strukturert logging/observability-fundament
- [x] Definer environment/config-håndtering
- [x] Design DB-schema (basert på §5 kjernedatamodell)
- [x] Design tenant-modell og tenant-isolasjonsstrategi
- [x] Design authentication-modell (§6)
- [x] Design authorization-rammeverk (RBAC/permissions, §5 Role/Permission)
- [x] Design error handling-strategi
- [x] Definer teststrategi (§44)

---

## Fase 1 — Core MVP

Mål: hele den vertikale flyten (§42) skal fungere uten mock-data.

### 1.1 Shopify install & auth
- [x] Implementer Shopify install/OAuth-flyt
- [x] Implementer `Shop`- og `ShopifyInstallation`-modeller
- [x] Krypter access tokens/secrets

### 1.2 Agent-autentisering
- [x] Implementer direkte agent-login (passwordless e-post / magic links, §6.2)
  - [x] Single-use tokens
  - [x] Kort levetid
  - [x] Hashed token-lagring
  - [x] Rate limiting
  - [x] Session revocation
  - [x] Generiske svar (avslør ikke om e-post finnes)
  - [x] Sikre `httpOnly` cookies
  - [x] CSRF-beskyttelse
  - [x] Riktig SameSite-policy
- [x] Implementer invitasjonsflyt (§6.3): navn, e-post, rolle, team, butikktilgang, utløpsdato
- [x] Implementer RBAC med minimumsroller: `OWNER`, `ADMIN`, `AGENT`, `EXTERNAL_AGENT`, `VIEWER`
- [x] Implementer permission-modell (`Role`, `Permission`, `RolePermission`)
- [x] Implementer basic team management (`Team`, `TeamMembership`)

### 1.3 Kjernedatamodeller (§5)
- [x] `Customer`
- [x] `Ticket` (status: NEW, OPEN, WAITING_FOR_CUSTOMER, WAITING_FOR_AGENT, RESOLVED, CLOSED; source: EMAIL, STOREFRONT, MANUAL, API)
- [x] `TicketMessage` (senderType: CUSTOMER, AGENT, AI, SYSTEM)
- [x] `TicketFollower`
- [x] `InternalNote`
- [x] `AssignmentHistory`
- [x] `Attachment`
- [x] `AIInstruction`
- [x] `KnowledgeDocument`
- [x] `KnowledgeChunk` (med eksplisitt `shopId` for tenant-sikker vector search)
- [x] `AIExecution`
- [x] `AuditEvent`
- [x] `Invitation`

### 1.4 Ticket Inbox (§7)
- [x] Implementer køer/filtre: All, New, Mine, Unassigned, Waiting, AI handled, Needs review, High priority, Resolved
- [x] Bygg ticket-liste (nummer, kunde, subject, kategori, tidspunkt, priority, status, assignee/team, AI-status, SLA-status)
- [x] Bygg ticketvisning: samtaletråd, composer, AI reply suggestion, internal notes, assignment/transfer, tags, followers, attachments
- [x] Bygg høyrepanel med Shopify-kontekst

### 1.5 E-post inn/ut (§10)
- [x] Sett opp inbound email provider + verifisert webhook
- [x] Implementer shop-resolving fra innkommende e-post
- [x] Implementer find/create customer
- [x] Implementer find/create ticket
- [x] Implementer TicketMessage-opprettelse
- [x] Enqueue AI-prosessering som background job
- [x] Bevar `Message-ID`, `In-Reply-To`, `References`, sender, recipients, CC
- [x] Bevar plain text, HTML, attachments
- [x] Implementer korrekt threading av svar på riktig ticket
- [x] Implementer outbound e-post fra butikkens supportidentitet
- [x] Implementer idempotency og retry-håndtering for e-post

### 1.6 Shopify-kontekst (§12)
- [x] Implementer Shopify customer lookup
- [x] Implementer Shopify order lookup (ordrenummer, dato, line items, payment status, fulfillment, tracking, refund/cancellation status)
- [x] Bruk minste nødvendige Shopify-scopes
- [x] Implementer autorisasjonssjekk før sensitive ordredata vises (ikke stol på at bruker kjenner ordrenummer)

### 1.7 AI Knowledge (manuell, §13–14)
- [x] Bygg admin-UI for AI-instruksjoner (`AI → Instructions`)
- [x] Støtt instruction types: GENERAL, TONE, RETURNS, SHIPPING, COMPLAINTS, PRODUCTS, ESCALATION, PROHIBITED_BEHAVIOR, CUSTOM
- [x] Bygg admin-UI for manuelle knowledge-artikler (`AI → Knowledge`)
- [x] Implementer chunking og embeddings for knowledge-dokumenter

### 1.8 RAG-pipeline (§15–16)
- [x] Implementer tenant-filtrert semantisk + metadata knowledge search
- [x] Sørg for sporbarhet: chunk → dokument/avsnitt
- [x] Implementer "jeg vet ikke"-håndtering ved utilstrekkelig kunnskapsgrunnlag
- [x] Vis confidence, Shopify-fakta, knowledge sources, validation warnings, automation decision i agent-UI
- [x] La agent kunne åpne kilde som ble brukt

### 1.9 AI Orchestrator (§17–19)
- [x] Implementer classification-steg (strukturert output: category, priority, sentiment, urgency, requiresHuman, language, requestedActions, confidence)
- [x] Implementer context retrieval-steg (Shopify + knowledge)
- [x] Implementer candidate response-generering med source/context metadata
- [x] Implementer validation-steg (§18: grounding, ordre-/trackingkonsistens, unsupported claims, business rules, refund/cancellation-løfter, faktisk svarer på spørsmålet, krever menneske)
- [x] Implementer automation policy-beslutning (AUTO_SEND, HUMAN_REVIEW, ESCALATE, NO_RESPONSE)
- [x] Implementer **Copilot mode** som MVP-standard (AI genererer utkast, sender aldri automatisk)

### 1.10 Ticket-drift
- [x] Implementer ticket status-håndtering
- [x] Implementer assignment/transfer (grunnleggende)
- [x] Implementer internal notes med eksplisitt visibility (aldri synlig for kunde)

### 1.11 Audit (basic)
- [x] Implementer append-only `AuditEvent`-logging for kritiske hendelser i MVP-scope

### 1.12 Exit-kriterium Fase 1
- [x] Verifiser hele vertikalflyten (§42) fungerer end-to-end uten mock-data: install → agent-invitasjon → inbound e-post → ticket → kundematch → ordrekontekst → knowledge-retrieval → AI-utkast → validering → menneskelig godkjenning → utsendt svar → kundens neste svar havner på samme tråd

---

## Fase 2 — Support Operations

- [x] Implementer `Team`-administrasjon (utover basic)
- [x] Implementer followers på tickets
- [x] Implementer `@mentions`
- [x] Implementer notifications (in-app + e-post, §26): assignment, transfer, mention, customer reply, AI escalation, critical ticket, SLA-nærmer-seg-brudd, collaborator-invitasjon
- [x] Implementer `EXTERNAL_AGENT`-rolle med begrenset tilgang (§6.5): én butikk, bestemte teams, egne/teammets tickets, field-level Shopify-restriksjoner, utløpsdato
- [x] Implementer Ticket Collaborator — ekstern ekspert på én sak (§9)
  - [x] Invite collaborator-flyt
  - [x] Les nødvendig ticket-kontekst
  - [x] Se eksplisitt tillatte vedlegg
  - [x] Skriv interne kommentarer
  - [x] Sperre browsing av andre tickets/kunder
  - [x] Sperre kundesvar uten særskilt permission
  - [x] Automatisk utløp/fjerning av tilgang ved saks-lukking
- [x] Implementer AI handover summary ved overføring (§8): kundens ønske, hva som er gjort, relevant ordre, løfter gitt, neste steg, risikopunkter
- [x] Implementer collision detection / presence ("Emma is viewing/replying")
- [x] Implementer agent availability-status (AVAILABLE, BUSY, AWAY, OFFLINE)
- [x] Implementer tags på tickets
- [x] Implementer sentiment-klassifisering
- [x] Implementer priority-håndtering
- [x] Implementer AI conversation summary
- [x] Implementer attachments (full støtte)
- [x] Implementer duplicate detection (samme kunde, tidspunkt, subject, semantic similarity, order number, email threading)
- [x] Implementer ticket merging med bevart audit history
- [x] Bygg Customer Timeline (kombinert support- og Shopify-historikk, §23)
- [x] Implementer SLA basics (§27): first response SLA, resolution SLA, priority-spesifikke targets, pause ved WAITING_FOR_CUSTOMER, warnings, overdue state
- [x] Implementer sortering av inbox etter SLA-risiko

---

## Fase 3 — Knowledge & Assisted AI

- [x] Implementer PDF-ingestion for knowledge
- [x] Implementer DOCX-ingestion for knowledge
- [x] Implementer URL-ingestion for knowledge
- [x] Implementer sync av Shopify Pages
- [x] Implementer sync av Shopify Products
- [x] Implementer betingede instrukser (§13): `WHEN category = X`, `WHEN sentiment = X`, `WHEN customer.language = X`
- [x] Bygg full knowledge management-UI (aktiver/deaktiver, rediger, slett, erstatt, tag, kategoriser, gyldighetsperiode, reindeksering, sync-status)
- [x] Implementer Knowledge Gap Detection (§29): registrer manglende dokumentasjon/korrigerte svar, aggreger mønstre, "Generate knowledge article"-forslag med krav om menneskelig godkjenning før publisering
- [x] Implementer agent feedback loop (§30): thumbs up/down, lagre AI candidate vs. final response personvernbevisst
- [x] Bygg AI Test Center (§31): scenario-testing uten utsending, vis category/sources/confidence/decision/reason, ingen e-post eller Shopify-actions under replay
- [x] Implementer **Assisted mode** (AI sender automatisk innenfor godkjente kategorier/threshold/policy)
- [x] Implementer konfigurerbare confidence/policy thresholds
- [x] Implementer avansert validation (utvidelse av §18)

---

## Fase 4 — Storefront & Automation

- [x] Bygg storefront support-skjema (§11): e-post, subject, melding, valgfritt ordrenummer, vedlegg
- [x] Implementer AI self-service-flyt (§11): AI søker knowledge + Shopify-kontekst → svar → "Løste dette problemet?" → ticket opprettes ved nei
- [x] Design/implementer authenticated customer account-integrasjon der relevant
- [x] Bygg Automation Rule-motor / business rules (§21, datamodell `AutomationRule`)
- [x] Implementer avansert routing/load balancing basert på agent availability
- [x] Design/implementer Incident Mode (§33): gruppering av relaterte tickets, godkjent incident-kontekst, bulk update-forslag, auto-relatering av nye tickets, lukking av incident
- [x] Legg grunnlag for proaktiv kundeservice (§32) — kun forslag/godkjenningsflyt, ikke autonom masseutsending

---

## Fase 5 — Controlled Actions

- [x] Design action framework for AI Actions (§20)
- [x] Implementer read actions: `getCustomer`, `getOrder`, `getTracking`, `getProduct`, `getRelevantTickets`
- [x] Design write actions m/ human approval-krav: `cancelOrder`, `refundOrder`, `editOrder`, `issueDiscount`, `changeAddress`, `createReturn`, `createReplacementOrder`
- [x] Implementer explicit permission per action
- [x] Implementer policy check per action
- [x] Implementer idempotency for actions
- [x] Implementer human approval-flyt der nødvendig
- [x] Implementer full action audit log
- [x] Implementer action result-håndtering
- [ ] Design rollback/compensation-strategi der mulig (`orderCancel`/`refundCreate` er irreversible i Shopify API-et; ingen kompensasjonslogikk utover audit-sporing er bygget ennå)
- [x] Implementer granulære action permissions
- [x] Implementer deterministiske guardrails
- [x] Aktiver **Autopilot mode** kun for eksplisitt godkjente scenarier (per-action `autopilotEnabled` toggle, av som standard, konfigureres i `/app/action-policies`)

---

## Fase 6 — SaaS Scale

- [ ] Implementer billing
- [ ] Implementer plan/usage limits
- [ ] Bygg avanserte analytics (§38): AI Resolution Rate, suggestion acceptance, edit rate, auto-send rate, escalation rate, validation failures, knowledge gaps, agent workload, SLA compliance, category volume
- [ ] Implementer CSAT-innsamling (§39): emoji-rating koblet til ticket/agent/AI/category/response-tid/automation mode
- [ ] Implementer AI cost-tracking (tokens, modell, estimert kostnad, kostnad per ticket/AI-løst ticket)
- [ ] Bygg ROI-estimering (agent-timer spart, support-kostnad spart, automation rate) — transparent og konfigurerbar, ikke presentert som eksakte fakta
- [ ] Implementer enterprise SSO (passkeys, Microsoft Entra ID, Google Workspace, SAML)
- [ ] Implementer enterprise controls
- [ ] Bygg avansert observability
- [ ] Implementer data retention-konfigurasjon
- [ ] Bygg operational tooling

---

## Tverrgående arbeid (løpende gjennom alle faser)

### Sikkerhet & personvern (§34, §36–37)
- [ ] Implementer spam/phishing/auto-reply-håndtering for inbound e-post
- [ ] Implementer HTML sanitization
- [ ] Implementer beskyttelse mot prompt injection (e-post, dokumenter, nettsider skal aldri overstyre system-/merchant-policy)
- [ ] Verifiser least-privilege Shopify scopes
- [ ] Krypter tokens/secrets
- [ ] Implementer secure sessions
- [ ] Verifiser tenant isolation i alle datalag (DB, vector search, cache, logger, AI-prompts)
- [ ] Implementer data retention-policy
- [ ] Implementer data export (GDPR)
- [ ] Implementer data deletion/redaction (GDPR)
- [ ] Implementer nødvendige Shopify compliance webhooks
- [ ] Implementer tilgangsrevokering
- [ ] Verifiser ingen secrets/persondata i logger
- [ ] Implementer masking av sensitive data
- [ ] Implementer full audit log-dekning (§37-listen: login, failed login, invitasjoner, membership-endringer, rolle/permission-endring, assignment/transfer, collaborator-invitasjon, data-tilgang, AI auto-send/escalation, Shopify action proposed/approved/executed, knowledge-endring, automation rule-endring)
- [ ] Verifiser Shopify App Store- og privacy-krav ved implementeringstidspunkt

### Webhooks & event processing (§35)
- [ ] Implementer signature/HMAC-verifisering for alle webhooks
- [ ] Implementer idempotency og duplicate detection
- [ ] Implementer retries og dead-letter handling
- [ ] Sørg for at HTTP webhook-handlers returnerer raskt (validering + enqueue)
- [ ] Flytt tunge operasjoner (AI-kall, embeddings, dokumentparsing, sync, e-post, analytics) til background jobs

### Teststrategi (§44)
- [ ] Unit tests: authorization, tenant filtering, ticket state transitions, assignment, email threading, automation rules, AI policy decisions, knowledge filtering
- [ ] Integration tests: Shopify API-adaptere, e-post webhooks, outbound e-post, DB, vector retrieval, background jobs
- [ ] Security tests: cross-tenant access, permission escalation, utløpte invitasjoner, collaborator scope, webhook forgery, replay/idempotency, prompt injection
- [ ] Bygg AI eval-sett (order status, returns, warranty, complaints, ambiguous, missing knowledge, adversarial/prompt injection, human-request, risky actions)
- [ ] Evaluer AI på: factual grounding, korrekt kategori, korrekt eskalering, policy compliance, source relevance, unsupported claims, språk/tone

### Observability (§45)
- [ ] Implementer strukturert logging med correlation IDs
- [ ] Mål webhook processing, job failures, e-post levering, AI latency/errors, Shopify API-feil, vector search-latency, ticket processing-latency, token/kostnadsbruk
- [ ] Verifiser at secrets/unødvendige persondata aldri logges

### UX & coding standards (§46–48)
- [ ] Design ticketvisning etter prioritert informasjonshierarki (§46)
- [ ] Håndhev TypeScript strict mode
- [ ] Håndhev server-side authorization på alle sensitive operasjoner
- [ ] Håndhev tenant filtering i repository/service-lag
- [ ] Håndhev schema validation på ekstern input
- [ ] Håndhev idempotency for webhooks/actions
- [ ] Sørg for reviewable migrations
- [ ] Bruk feature flags for risikable/ufullførte funksjoner
- [ ] Definition of Done pr. feature: datamodell/migration, authorization, service/domain logic, API/route, UI, validation, error handling, audit/logging, tests, tenant isolation-test, dokumentasjon, grønn typecheck/lint/test

---

## Ikke bygg for tidlig (§50 — bevisst utsatt til riktig fase)

- [ ] Full chat-widget
- [ ] Avansert no-code automation builder
- [ ] Autonom refund/cancellation
- [ ] Avansert load balancing
- [ ] Incident-automasjon
- [ ] Proaktiv bulk-utsending
- [ ] Enterprise SSO
- [ ] Avansert ROI-dashboard
- [ ] Full billing/plan-motor
- [ ] Komplekst custom-role UI

---

## Nordstjerne-metrikker å instrumentere tidlig (§52)

- [ ] AI Resolution Rate
- [ ] Human Escalation Rate
- [ ] AI Suggestion Acceptance Rate
- [ ] Unsupported Claim / Validation Failure Rate
- [ ] First Response Time
- [ ] Resolution Time
- [ ] CSAT
- [ ] Cost per Resolved Ticket
- [ ] Knowledge Gap Rate

> Sikkerhet og svarkvalitet skal veie tyngre enn høyest mulig automation rate.
