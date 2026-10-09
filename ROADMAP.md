# Roadmap — AI-First Customer Support for Shopify

This roadmap translates the product plan in [shopify_ai_customer_support_development_plan.md](shopify_ai_customer_support_development_plan.md) into a practical build sequence. The objective is not to ship everything at once, but to reach the first fully working vertical flow in a controlled, reviewable order.

## Goal

Build a Shopify support system that can:

1. install and authenticate a merchant shop,
2. ingest customer email and ticket conversations,
3. match the customer and their order history in Shopify,
4. retrieve relevant knowledge and policy context for a support response,
5. produce an AI-assisted draft for human approval,
6. send the final response through the merchant's support identity,
7. continue the conversation on the same ticket thread.

That end-to-end flow is the MVP gate for the project.

---

## Phase 0 — Foundation & preparation

Goal: lock the product architecture, security model, and implementation boundaries before writing business logic.

Completed or in progress in this repository:
- app scaffold and Shopify app configuration are in place
- Architecture decisions have been documented in [ARCHITECTURE.md](ARCHITECTURE.md)
- environment variables are defined in [.env.example](.env.example)
- shared security and tenant assumptions are captured in [SECURITY.md](SECURITY.md)

Remaining work:
- confirm the final database schema and migration plan
- confirm the exact shop identity and session model for admins vs portal users
- confirm provider interfaces and env-driven composition for AI, embeddings, email, storage, and queueing
- define service boundaries and permission checks before feature implementation

Exit criterion:
- all mandatory environment variables, auth flows, provider contracts, and tenancy rules are codified and reviewed

---

## Phase 1 — Core MVP

Goal: deliver the working support desk in the app without mock data.

### 1.1 Shopify install & auth
- implement Shopify install/OAuth flow
- persist shop installation metadata and encrypted access tokens
- verify minimal scopes before reading customer/order data

### 1.2 Agent authentication and authorization
- create passwordless portal login flow
- support invitation-based access and team membership
- implement RBAC baseline (`OWNER`, `ADMIN`, `AGENT`, `EXTERNAL_AGENT`, `VIEWER`)
- enforce tenant-scoped permission checks on every sensitive endpoint

### 1.3 Core data model
- `Shop`, `ShopifyInstallation`, `User`, `ShopMembership`
- `Customer`, `Ticket`, `TicketMessage`, `InternalNote`, `AssignmentHistory`
- `Attachment`, `AIInstruction`, `KnowledgeDocument`, `KnowledgeChunk`
- `AIExecution`, `AuditEvent`, `Invitation`

### 1.4 Ticket inbox and conversation view
- inbox filters and list view
- ticket detail, message thread, composer, and agent actions
- internal notes and assignment flow
- Shopify context panel

### 1.5 Email in/out
- inbound email webhook handling with signature validation and queueing
- ticket matching and threading by `Message-ID` / `In-Reply-To` / `References`
- outbound support email using the merchant identity
- retry and idempotency handling

### 1.6 Shopify customer and order context
- customer lookup by email/phone/shopify IDs
- order lookup and authorized data retrieval
- least-privilege access to customer and order content

### 1.7 AI knowledge administration
- AI instructions admin
- knowledge article admin
- chunking and embedding pipeline for knowledge documents

### 1.8 RAG and orchestration
- tenant-filtered knowledge retrieval
- classify → retrieve → generate → validate → decision pipeline
- traceability from response to source content and Shopify facts

### 1.9 Copilot mode
- AI drafts responses but never auto-sends in MVP
- human approval gate remains mandatory

### 1.10 Exit criteria for Phase 1
The full vertical flow works end-to-end without mock data:
- install → invite agent → inbound email → ticket creation → customer match → order context → knowledge retrieval → AI draft → validation → human approval → outbound response → next incoming reply lands in the same thread

---

## Phase 2 — Support operations

Enhance ticket operations and agent workflows:
- team administration and membership lifecycle
- followers, mentions, notification rules
- assignment and transfer
- SLA handling
- customer timeline
- duplicate detection and merging
- external collaborator model and scoping

---

## Phase 3 — Knowledge & assisted AI

Scale the AI system beyond a simple draft flow:
- PDF/DOCX/URL ingestion
- Shopify sync for pages and products
- conditional instructions and knowledge management UI
- knowledge gap detection and feedback loop
- AI Test Center and assisted mode with policy thresholds

---

## Phase 4 — Storefront & automation

Support more customer-self-service and automated handling:
- storefront support form
- AI self-service flow
- automation rule engine
- incident grouping and bulk handling proposals
- authenticated customer account integration where relevant

---

## Phase 5 — Controlled actions

Introduce safe, explicit action execution only when necessary:
- read actions (`getCustomer`, `getOrder`, `getTracking`, etc.)
- human-approved write actions (`cancelOrder`, `refundOrder`, `editOrder`, etc.)
- policies and guardrails for every write action
- audit history and idempotency enforcement

---

## Phase 6 — SaaS scale

When the foundation is stable, expand to product scale:
- billing and plan limits
- analytics and cost tracking
- CSAT and ROI reporting
- enterprise SSO and compliance controls
- deeper observability and operational tooling

---

## Delivery principles

1. Each feature must satisfy the Definition of Done before being considered complete.
2. No feature bypasses tenant isolation and server-side authorization.
3. No AI action is trusted without validation and human approval in MVP.
4. Every meaningful workflow must be traceable through logs and `AIExecution` records.
5. Hidden complexity is deferred until the phase in which it is required.

---

## Near-term focus

The immediate build order is:

1. finalize tenant-aware database schema and migrations
2. complete the security baseline and auth model
3. implement Shopify installation + embedded auth flow
4. implement core ticket creation and threading
5. wire in knowledge retrieval and AI draft generation
6. validate the full ticket lifecycle end-to-end

This sequence keeps the work honest: the product wins by shipping a reliable support loop before broad automation or scale features are added.
