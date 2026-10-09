# Security — AI-First Customer Support for Shopify

This document captures the baseline security rules for this project and should be treated as the implementation checklist for any production-facing feature.

## 1. Security principles

- least privilege is the default for Shopify scopes, database access, AI access, and provider permissions
- tenant isolation is enforced at the data layer, not only in the UI
- secrets are never logged, never embedded in frontend code, and are encrypted when stored
- all sensitive actions are re-checked server-side before execution
- AI-generated outputs are never treated as authoritative facts without validation

---

## 2. Identity and access model

The platform has three distinct identity concepts:

1. Shopify installation identity
   - represents the merchant's store connection
   - stores the app's encrypted access token and scopes
   - tracks installation and uninstall lifecycle

2. User identity
   - represents a human operator or internal admin user
   - lives independently from Shopify and supports the standalone portal flow

3. Shop membership
   - joins a `User` to a `Shop`
   - carries the role, status, invite metadata, and any expiry rules
   - enables access restrictions such as `EXTERNAL_AGENT`

### Rules
- all user actions must resolve to the authenticated session and then to an authorized `ShopMembership`
- UI access checks are helpful but never authoritative
- server-side authorization is the security boundary
- per-shop permissions must be checked for every read/write operation, not just route-level checks

---

## 3. Multi-tenancy and data isolation

### Requirements
- every tenant-owned table must include a `shopId` and be queried with it in `where` clauses
- no repository method may trust client-supplied IDs as proof of access
- vector search must apply `shopId` in the same SQL query that performs similarity retrieval
- no AI prompt may mix customer or knowledge data from two different shops in one operation

### Implementation contract
- `AuthorizationService` is the one place that answers "can this user see or do this?"
- `TenantContext` or equivalent helper code must assert access before database reads or writes
- all logs and correlation IDs must include `shopId` when known

---

## 4. Secrets and tokens

### Secret storage
- Shopify access tokens and other sensitive credentials are encrypted at rest using AES-256-GCM
- single-use auth and invitation tokens are hashed before storage using a keyed hash or a secure HMAC flow
- transport security must be enforced with TLS only

### Session handling
- portal magic-link sessions use short-lived single-use tokens
- cookies for the standalone portal must be `httpOnly`, `Secure`, and `SameSite=Lax` or stricter
- login responses for unknown users must be generic and must not reveal whether an email is registered
- session revocation and expiry are required for all portal authentication flows

### Secret rotation and management
- secrets are supplied through env variables only
- `.env` files are never committed to the repository
- environment-specific secrets live in the hosting provider's secret store or deployment config

---

## 5. Webhooks and external input

### Requirements
- all inbound webhooks must validate signatures/HMACs
- webhook handlers must validate payloads with `zod` or equivalent before enqueueing jobs
- heavy processing must happen in background jobs, not in the webhook HTTP handler
- all webhook processing must be idempotent and retry-safe

### Guardrails
- queue jobs only after validation and minimal required parsing
- avoid processing user-controlled content directly in a request thread
- if a webhook payload cannot be validated, reject it without side effects

---

## 6. Email security

For customer support email flows:
- validate the inbound email provider webhook before accepting payloads
- maintain `Message-ID`, `In-Reply-To`, and `References` so replies stay on the correct ticket thread
- sanitize HTML and strip untrusted content before presenting it to agents or AI
- apply prompt-injection filtering to inbound email, attachments, and customer-provided documents
- do not allow customer content to override system policies or merchant instructions

---

## 7. AI and prompt security

AI safety is a first-class requirement, not an afterthought.

### Guardrails
- AI systems should never be allowed to make unsupported claims about orders, refunds, shipping, or policy exceptions without verification
- billing, refund, or cancellation decisions must require explicit approval workflows
- the model must only act on authorized Shopify data that is fetched through the approved service layer
- AI retrieval must be tenant-scoped and auditable

### Validation checks
- grounding: responses must be tied to retrieved facts, not fabricated claims
- business rule compliance: no unauthorized promise or policy exception
- order and tracking consistency: no answer should contradict actual order or fulfillment state
- escalation: human review must be triggered when the model is uncertain or the action is high-risk

---

## 8. Attachments and document handling

- attachments are stored with a provider abstraction, not directly in route code
- object storage keys should not reveal tenant or user identity in a predictable way
- uploaded documents must be scanned for unsafe or malformed content before they are used by AI or other services
- access to attachments must remain tenant-bound and authorization-checked

---

## 9. Audit and observability

The platform must have append-only audit logging for high-impact events, including:
- login / failed login
- invitation and membership changes
- role/permission changes
- assignment / transfer / escalation
- collaborator invitation and expiry
- Shopify actions proposed / approved / executed
- knowledge changes
- automation updates
- AI auto-send or escalation decisions

`AuditEvent` is not optional in production. It is part of the operating model and the compliance baseline.

---

## 10. Data privacy and retention

- sensitive customer and order data must be minimized to what is needed for a support workflow
- logs must avoid storing raw secrets or customer PII unless strictly required for debugging
- retention and deletion policies must be configurable per tenant and governed by business/legal requirements
- GDPR-style export and deletion flows are required for product maturity, even if they are not fully implemented in the initial MVP

---

## 11. Security testing

The baseline test suite must cover:
- cross-tenant data access attempts
- permission escalation attempts
- expired or revoked invitations
- collaborator access restrictions
- webhook forgery and replay attacks
- prompt injection and adversarial customer input
- idempotency and retry safety

---

## 12. Production gating checklist

Do not ship a feature if any of the following are unverified:
- tenant isolation is enforced in the repository/service layer
- the endpoint has server-side permission checks
- secrets are encrypted and not logged
- the feature has a relevant audit trail
- the feature has a security test or a documented risk assessment
- the AI output path has validation and escalation guardrails

This project is intentionally conservative: support quality, safety, and privacy matter more than maximum automation rate.
