# Architecture — AI-First Customer Support for Shopify

> Companion to [shopify_ai_customer_support_development_plan.md](shopify_ai_customer_support_development_plan.md) and [TODO.md](TODO.md).
> This document records the concrete architecture decisions for the plan's abstract requirements, and is the source of truth for "how things are built." Update it whenever a cross-cutting decision changes.

## 1. Confirmed technology stack

| Concern | Choice | Notes |
|---|---|---|
| Language | TypeScript, `strict: true` | Already enabled in `tsconfig.json`. |
| App framework | Shopify React Router app (`@shopify/shopify-app-react-router`) | Existing template, keep as-is. |
| Admin UI | Shopify App Bridge + Polaris | Embedded admin experience. |
| Admin API | Shopify Admin GraphQL API | No REST; least-privilege scopes (see §7). |
| Database | PostgreSQL on **Neon** (serverless Postgres) | Project `shopify-ai-customer-support` (id `silent-hill-44233818`), region `aws-us-east-2`. Provisioned via Neon MCP. |
| ORM | Prisma (`@prisma/client`, already in template) | `postgresqlExtensions` preview feature already enabled for `vector`. |
| Vector store | `pgvector` extension on the same Neon database | Verified working (`CREATE EXTENSION vector` succeeded on the project). No separate vector DB in MVP — avoids an extra moving part and keeps tenant filtering inside normal SQL/Prisma queries. |
| Background jobs | [`pg-boss`](https://github.com/timgit/pg-boss) (Postgres-backed queue) | Runs on the same Postgres instance — no Redis/extra infra needed for MVP. Revisit if throughput demands a dedicated broker. |
| Object storage | `StorageProvider` abstraction; local filesystem in dev, S3-compatible (AWS S3 or Cloudflare R2) in production | Provider chosen at deploy time via env; no hard dependency on one vendor. |
| AI provider | `AIProvider` abstraction with **Anthropic (Claude)** as the default/primary implementation and an **OpenAI** implementation stubbed alongside it | Decided 2026-09-02: build both adapters now, switch primary via `AI_PROVIDER` env var. Domain code never imports a vendor SDK directly. |
| Embeddings | `EmbeddingProvider` abstraction; OpenAI `text-embedding-3-small` as default implementation | Anthropic has no first-party embeddings API at time of writing; OpenAI's embedding endpoint is used purely for vectorization, independent of which `AIProvider` generates text. |
| Email | `EmailProvider` abstraction; **Postmark** as the concrete implementation (inbound webhook + outbound send) | Decided 2026-09-02. Postmark's inbound webhook delivers parsed JSON (headers, text/HTML body, attachments) which simplifies §10 threading requirements. |
| Logging | Structured JSON logging (`pino`) with a correlation ID per request/job | See §9. |
| Validation | `zod` for env config and all external input (webhooks, forms, AI structured output) | |
| Secrets/tokens | Node `crypto` (AES-256-GCM) for encrypting Shopify access tokens at rest; SHA-256 hashing for single-use auth/invitation tokens | See `SECURITY.md`. |

Deprecated/rejected for now: a dedicated vector DB (Pinecone/Weaviate/etc.) — unnecessary complexity while ticket/knowledge volume is small; revisit only if pgvector query latency becomes a bottleneck (§45 observability should surface this before it's a guess).

## 2. Multi-tenancy

- Every tenant-owned table carries an explicit `shopId` foreign key to `Shop`. There is no implicit tenancy via, e.g., a shared `organizationId` hierarchy — `Shop` **is** the tenant.
- No service or query trusts a `shopId`/`ticketId`/`customerId` value that originates from the client without first re-deriving/verifying it from the authenticated session (Shopify session or agent session) server-side.
- **Rule:** every Prisma query against a tenant-owned model must include `shopId` in its `where` clause. This is enforced by convention + code review initially (§44 unit tests assert this for each service); a lint rule or repository-wrapper may be added later if hand-written queries prove error-prone.
- Vector search (`KnowledgeChunk`) always filters by `shopId` in the same SQL query that does the similarity search — never post-filtered in application code, to avoid leaking a cross-tenant result to the model in case of a bug.
- Structured logs and AI prompts never interpolate data from more than one `shopId` in a single operation; the correlation ID and log context always carry `shopId` so cross-tenant leaks are auditable if they ever occur.

## 3. Identity model

Three separate concepts, per the plan (§3.2):

- **`ShopifyInstallation`** — a shop's Shopify connection: encrypted offline access token, granted scopes, install/uninstall timestamps. One per `Shop` (a `Shop` cannot exist without having installed at least once).
- **`User`** — a person who can use the support platform (agent, admin, owner). Not a Shopify concept. A `User` authenticates either by arriving through Shopify Admin (embedded session) or via the standalone portal's passwordless email login.
- **`ShopMembership`** — join model between `User` and `Shop`, carrying `roleId`, status, invite metadata, optional expiry (used for `EXTERNAL_AGENT`). A `User` can hold memberships in multiple shops (e.g. an agency agent).

The embedded Shopify admin route and the standalone portal (`/portal/*` in this app initially; a separate subdomain can come later) both resolve to the same `User`/`ShopMembership` records — there is one identity system, two entry points.

## 4. Service layer

UI routes (`app/routes/**`) only: parse/validate input, call a service, shape the response. No Prisma calls and no business rules in route files.

Planned services (`app/services/*.server.ts`), matching §3.3 of the plan:

- `TicketService` — ticket CRUD, status transitions, threading.
- `CustomerService` — customer lookup/matching, Shopify customer sync.
- `ShopifyContextService` — authorized reads of Shopify customer/order/product data for AI and UI.
- `KnowledgeService` — knowledge documents/chunks, ingestion, chunking, embedding orchestration.
- `EmailService` — inbound parsing → ticket creation, outbound sending, threading headers.
- `AIOrchestrator` — runs the classify → retrieve → generate → validate → decide pipeline (§17).
- `AIValidationService` — grounding/policy/business-rule checks on AI output (§18).
- `AssignmentService` — assignment/transfer/team routing.
- `AuthorizationService` — permission checks; the only place that answers "can this User do X on this Shop's data."
- `NotificationService` — in-app + email notifications via `NotificationProvider`.
- `AutomationEngine` — evaluates `AutomationRule`s (Phase 4+, interface designed earlier).
- `AuditService` — append-only audit event writes.
- `AgentAuthService` — magic-link issuance/verification, session management (portal login).

The AI model itself never calls Shopify or Prisma directly. `AIOrchestrator` calls `ShopifyContextService`/`KnowledgeService` on the model's behalf and passes back only the retrieved, authorized data as context.

## 5. Provider abstractions

Interfaces live in `app/providers/*/{name}-provider.ts`; concrete adapters live alongside them. Services depend only on the interface type; the concrete instance is selected once, in a small composition root (`app/lib/providers.server.ts`), based on env config.

```ts
interface AIProvider {
  classify(input: ClassificationInput): Promise<ClassificationResult>;
  generate(input: GenerationInput): Promise<GenerationResult>;
}

interface EmbeddingProvider {
  embed(texts: string[]): Promise<number[][]>;
}

interface EmailProvider {
  send(message: OutboundEmail): Promise<void>;
  parseInbound(payload: unknown): InboundEmail; // validated with zod
}

interface StorageProvider {
  put(key: string, data: Buffer, contentType: string): Promise<{ storageKey: string }>;
  getUrl(storageKey: string): Promise<string>;
}

interface NotificationProvider {
  notify(userId: string, notification: NotificationPayload): Promise<void>;
}
```

Swapping Anthropic ↔ OpenAI, or Postmark ↔ SendGrid, means writing a new adapter — no changes to any service.

## 6. Folder structure

```text
app/
  routes/                        # thin React Router routes only
    app.tsx, app._index.tsx      # existing embedded admin shell
    app.inbox*.tsx                # ticket inbox (Phase 1)
    app.knowledge*.tsx            # AI knowledge admin UI (Phase 1/3)
    app.settings*.tsx             # merchant settings (Phase 1+)
    portal.login.tsx              # passwordless agent login (Phase 1)
    portal.*.tsx                  # standalone agent portal
    webhooks.app.*.tsx            # existing Shopify compliance/app webhooks
    webhooks.email.inbound.tsx    # Postmark inbound webhook (Phase 1)
    api.*.tsx                     # JSON endpoints where needed (e.g. AI Test Center)
  services/                      # business logic, one file per service (see §4)
  providers/
    ai/            (ai-provider.ts, anthropic.provider.ts, openai.provider.ts)
    embedding/     (embedding-provider.ts, openai-embedding.provider.ts)
    email/         (email-provider.ts, postmark.provider.ts)
    storage/       (storage-provider.ts, local.provider.ts, s3.provider.ts)
    notification/  (notification-provider.ts, ...)
  jobs/                           # pg-boss job handlers (one per background task)
  lib/
    config.server.ts              # zod-validated typed env access
    logger.server.ts              # pino logger + correlation id helper
    queue.server.ts               # pg-boss instance + job registration
    crypto.server.ts              # token hashing, access-token encryption
    errors.ts                     # typed error hierarchy
    tenant.ts                     # tenant-context assertion helpers
  db.server.ts                    # existing Prisma client singleton
  shopify.server.ts               # existing Shopify app config
prisma/
  schema.prisma
  migrations/
extensions/                       # existing Shopify extensions workspace (untouched)
ARCHITECTURE.md
ROADMAP.md
SECURITY.md
.env.example
```

Rationale: `services` and `providers` are separated because services encode business rules that are specific to this product, while providers are swappable vendor integrations. Keeping AI/email/storage vendor code out of `services/` is what makes the "swap Postmark for SendGrid" or "swap Claude for GPT" promise real instead of aspirational.

## 7. Shopify integration

- Admin GraphQL API only, `ApiVersion.July26` (as already configured) — bump deliberately, not silently, when Shopify ships a new stable version.
- Scopes start minimal and grow only when a feature needs them. MVP needs at least: `read_customers`, `read_orders`, `read_products`. Nothing write-side is requested until Phase 5 (Controlled Actions) actually needs it — no `write_orders` scope exists in the app until `cancelOrder`/`refundOrder`/etc. are implemented with human approval.
- `ShopifyContextService` is the only code that calls the Admin API for customer/order/product data on behalf of AI or agent UI; it enforces "don't trust a client-supplied order number" by re-deriving the order from the authenticated customer/ticket relationship.

## 8. Authentication & authorization

- **Shopify embedded session**: handled by the existing `@shopify/shopify-app-react-router` OAuth flow — unchanged.
- **Portal session (passwordless)**: magic-link email → single-use, SHA-256-hashed, short-lived (15 min) token → session cookie (`httpOnly`, `Secure`, `SameSite=Lax`) backed by a `Session`-like server-side record so it can be revoked. Rate-limited per email/IP. Login response is always generic ("if that address has access, we've sent a link") regardless of whether the email exists, per plan §6.2.
- **Authorization**: permission-based, not role-name-based. `AuthorizationService.can(user, shop, permission, resource?)` is the single choke point; UI hides actions the user can't take, but the server re-checks every time — the UI check is a convenience, never the security boundary.
- `EXTERNAL_AGENT` and `TicketCollaborator` scoping (single shop, specific teams/tickets, field-level Shopify data restrictions, expiry) is modeled as data (on `ShopMembership`/`TicketCollaborator`), not as special-cased code paths, so `AuthorizationService` stays the one place permission logic lives.

## 9. Observability & error handling

- `logger.server.ts` wraps `pino`; every request/job gets a correlation ID (generated at the edge — HTTP request or job start — and threaded through service calls via a small async-local-storage context or explicit parameter, not a global).
- Log fields always include `correlationId` and `shopId` (when known); never include secrets, access tokens, or raw customer PII beyond what's needed to debug (e.g. log `customerId`, not full email/name, where an ID is enough).
- Errors use a typed hierarchy (`app/lib/errors.ts`): `NotFoundError`, `AuthorizationError`, `ValidationError`, `TenantMismatchError`, `ExternalServiceError` (wraps Shopify/AI/email failures with the provider name). Routes translate these to appropriate HTTP responses centrally rather than each route inventing its own error shape.
- `AIExecution` records (§5 of the plan) double as an AI-specific observability trail: model, tokens, latency, cost, decision — queryable without re-reading logs.

## 10. Background jobs

`pg-boss` runs against the same Neon database. Jobs planned for Phase 1:

- `email.inbound.process` — parse → find/create customer & ticket → create `TicketMessage` → enqueue AI job. Enqueued by the inbound webhook handler, which itself only validates the Postmark payload and enqueues (must return fast, per plan §35).
- `ai.ticket.process` — runs the `AIOrchestrator` pipeline for a ticket message.
- `knowledge.embed` — chunk + embed a `KnowledgeDocument` after create/update.
- `email.outbound.send` — send an agent/AI reply through `EmailProvider`, with retry/idempotency.

Each job handler is idempotent (safe to run twice for the same input) and dead-letters after N retries rather than looping forever, per plan §35.

## 11. RAG & AI Orchestrator pipeline

Implements plan §15–19 as a sequence of small, independently testable functions, not one large prompt:

```text
classify(message) → ClassificationResult
retrieveShopifyContext(ticket, classification) → ShopifyContext
retrieveKnowledge(shopId, message, classification) → KnowledgeChunk[]   // tenant-filtered pgvector search
generate(message, ShopifyContext, KnowledgeChunk[], AIInstruction[]) → CandidateResponse
validate(CandidateResponse, ShopifyContext, KnowledgeChunk[]) → ValidationResult
decide(ValidationResult, ShopConfig) → AUTO_SEND | HUMAN_REVIEW | ESCALATE | NO_RESPONSE
```

MVP ships in **Copilot mode only** — `decide()` can return `AUTO_SEND` as a computed value for future phases, but the orchestrator is hard-wired in Phase 1 to never act on it (always routes to `HUMAN_REVIEW`/`ESCALATE`). This means Assisted mode (Phase 3) is "flip a switch," not "rewrite the pipeline."

Every step's inputs/outputs relevant to the decision are persisted on `AIExecution` for traceability and later eval-set construction (plan §44).

## 12. Open items / assumptions to revisit

- Embedding model choice (OpenAI `text-embedding-3-small`) is a default, not a locked decision — revisit if Anthropic ships first-party embeddings, or if multilingual quality (Norwegian is a first-class language here) needs a different model.
- Object storage vendor (S3 vs. R2) is unset — defaults to local disk in dev; must be chosen before Phase 2 (Attachments — full support) ships to production.
- Standalone portal domain/deployment target is not yet decided; Phase 1 can ship the portal as routes in this same app (`/portal/*`) without a separate deployment, and split it out later if needed.
