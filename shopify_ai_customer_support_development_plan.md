# AI-First Customer Support for Shopify — Komplett utviklingsplan

> **Formål:** Dette dokumentet er en implementeringsplan og arbeidsinstruks for Codex / Claude Code.  
> Bygg løsningen iterativt. Ikke implementer alt samtidig. Prioriter en fungerende vertikal MVP-flyt, og behold arkitekturen utvidbar for senere faser.

---

## 1. Produktvisjon

Bygg en multi-tenant, AI-first kundeserviceplattform for Shopify-butikker.

Plattformen skal samle kundehenvendelser fra e-post og butikkens supportflate i ett ticketsystem. AI skal forstå kundens henvendelse, hente relevante fakta fra Shopify, søke i butikkens egne instrukser og dokumentasjon, og generere et presist svar.

Løsningen skal kunne utvikles gradvis fra **AI Copilot** til **AI Autopilot**:

1. AI leser og foreslår svar → menneske godkjenner.
2. AI svarer automatisk på trygge saker med høy sikkerhet.
3. AI foreslår handlinger i Shopify → menneske godkjenner.
4. AI utfører eksplisitt tillatte handlinger automatisk → mennesker håndterer unntak.

Det langsiktige hovedmålet er å måle **AI Resolution Rate**: andelen kundehenvendelser som blir fullstendig løst uten menneskelig involvering.

---

## 2. Overordnede produktområder

Applikasjonen skal organiseres rundt disse hovedområdene:

- **Inbox** — tickets, meldinger, svar, intern dialog, assignment og eskalering.
- **Customers** — kundeinformasjon, Shopify-ordre og samlet historikk.
- **AI Knowledge** — instrukser, dokumentasjon, Shopify-innhold, kunnskapshull og testing.
- **Team** — interne og eksterne agenter, teams, roller og permissions.
- **Automation** — AI-regler, routing, SLA og fremtidige Shopify-actions.
- **Analytics** — AI-effekt, supportytelse, CSAT, kostnader og ROI.
- **Settings** — Shopify, e-post, AI, sikkerhet og butikkinnstillinger.

---

## 3. Arkitekturprinsipper

### 3.1 Multi-tenancy

Løsningen skal være multi-tenant fra første dag.

Alle tenant-eide data skal knyttes til `shopId`.

All database- og service-tilgang skal verifisere tenant-kontekst server-side. Ikke stol på `shopId`, `customerId`, `ticketId` eller lignende sendt fra klienten uten autorisasjonskontroll.

Data fra én butikk må aldri kunne eksponeres for en annen butikk, heller ikke gjennom vector search, cache, logger eller AI-prompts.

### 3.2 Shopify og supportbrukere er separate konsepter

Ikke modeller en kundebehandler som en Shopify-bruker.

Bruk separate modeller:

- `ShopifyInstallation` — butikkens Shopify-tilkobling og tokens.
- `User` — person som bruker supportplattformen.
- `ShopMembership` — kobler User til Shop og rolle/permissions.

Merchant/admin skal kunne åpne løsningen via Shopify Admin, men daglig kundeservice skal også kunne utføres fra en separat portal, eksempelvis `app.example.com`.

### 3.3 Service layer

UI/routes skal ikke inneholde tung business logic.

Bruk eksplisitte services, eksempelvis:

- `TicketService`
- `CustomerService`
- `ShopifyContextService`
- `KnowledgeService`
- `EmailService`
- `AIOrchestrator`
- `AIValidationService`
- `AssignmentService`
- `AuthorizationService`
- `NotificationService`
- `AutomationEngine`
- `AuditService`

AI-modellen skal aldri kommunisere direkte med Shopify eller databasen. AI får tilgang gjennom eksplisitte, autoriserte tools/services.

### 3.4 Provider abstractions

Unngå hard kobling til én leverandør.

Definer interfaces som:

```ts
interface AIProvider {}
interface EmbeddingProvider {}
interface EmailProvider {}
interface StorageProvider {}
interface NotificationProvider {}
```

Implementasjoner skal kunne byttes uten å omskrive kjernelogikken.

---

## 4. Foreslått teknologistack

Bruk oppdatert Shopify-anbefalt app-stack på implementeringstidspunktet. Verifiser alltid gjeldende Shopify-dokumentasjon før konkrete API-, scope- og extension-valg.

Foretrukket utgangspunkt:

- TypeScript
- Shopify React Router app
- Shopify App Bridge
- Shopify Admin GraphQL API
- Shopify-kompatible UI-komponenter / Polaris der relevant
- PostgreSQL
- Prisma ORM
- pgvector eller tilsvarende vector store
- Background job queue
- Objektlagring for vedlegg/dokumenter
- Strukturert logging og observability
- AI provider abstraction
- Email provider med inbound webhooks

Ikke bruk deprecated Shopify API-er dersom moderne alternativer finnes.

---

## 5. Kjernedatamodell

Dette er et utgangspunkt. Juster etter repository og tekniske behov.

### Shop

```text
id
shopifyDomain
shopName
timezone
locale
defaultLanguage
aiEnabled
aiMode
autoReplyThreshold
createdAt
updatedAt
```

### ShopifyInstallation

```text
id
shopId
shopifyDomain
encryptedAccessToken
scopes
installedAt
updatedAt
uninstalledAt
```

### User

```text
id
email
name
status
lastLoginAt
createdAt
updatedAt
```

### ShopMembership

```text
id
userId
shopId
roleId
status
invitedBy
joinedAt
expiresAt
createdAt
```

### Role

```text
id
shopId nullable
name
description
```

### Permission / RolePermission

Eksempelpermissions:

```text
tickets.read
tickets.reply
tickets.assign
tickets.transfer
tickets.delete
tickets.internal_note
customers.read
orders.read
orders.refund
orders.cancel
knowledge.read
knowledge.write
agents.manage
teams.manage
settings.read
settings.write
analytics.read
automation.manage
```

### Team

```text
id
shopId
name
description
createdAt
```

### TeamMembership

```text
teamId
userId
```

### Customer

```text
id
shopId
shopifyCustomerId
email
name
phone
language
createdAt
updatedAt
```

### Ticket

```text
id
shopId
customerId
ticketNumber
subject
status
priority
category
source
assignedAgentId
assignedTeamId
assignedAt
assignedBy
assignmentReason
aiConfidence
aiHandled
sentiment
requiresHuman
firstResponseDueAt
resolutionDueAt
createdAt
updatedAt
resolvedAt
closedAt
```

Status:

```text
NEW
OPEN
WAITING_FOR_CUSTOMER
WAITING_FOR_AGENT
RESOLVED
CLOSED
```

Source:

```text
EMAIL
STOREFRONT
MANUAL
API
```

### TicketMessage

```text
id
ticketId
senderType
senderUserId nullable
senderEmail
bodyText
bodyHtml
emailMessageId
inReplyTo
references
aiGenerated
aiConfidence
createdAt
```

Sender type:

```text
CUSTOMER
AGENT
AI
SYSTEM
```

### TicketFollower

```text
ticketId
userId
createdAt
```

### InternalNote

Kan eventuelt modelleres som TicketMessage med intern visibility, men tilgang må være eksplisitt.

```text
id
ticketId
authorUserId
body
createdAt
```

### AssignmentHistory

```text
id
ticketId
previousAgentId
newAgentId
previousTeamId
newTeamId
performedBy
reason
createdAt
```

### Attachment

```text
id
ticketMessageId nullable
knowledgeDocumentId nullable
filename
mimeType
storageKey
size
createdAt
```

### AIInstruction

```text
id
shopId
name
type
content
priority
conditionsJson
enabled
createdAt
updatedAt
```

Instruction types kan eksempelvis være:

```text
GENERAL
TONE
RETURNS
SHIPPING
COMPLAINTS
PRODUCTS
ESCALATION
PROHIBITED_BEHAVIOR
CUSTOM
```

### KnowledgeDocument

```text
id
shopId
title
sourceType
sourceUrl
content
status
tags
validFrom
validUntil
lastSyncedAt
createdAt
updatedAt
```

### KnowledgeChunk

```text
id
shopId
documentId
content
embedding
metadata
chunkIndex
createdAt
```

`shopId` skal være eksplisitt tilgjengelig for sikker tenant-filtrering i vector search.

### AIExecution

```text
id
shopId
ticketId
messageId
model
operation
inputMetadata
retrievedKnowledge
shopifyContextMetadata
generatedOutput
validationResult
confidence
decision
inputTokens
outputTokens
estimatedCost
latencyMs
createdAt
```

Unngå unødvendig lagring av sensitive råprompts dersom metadata/referanser er tilstrekkelig.

### AuditEvent

```text
id
shopId
actorUserId nullable
eventType
entityType
entityId
metadata
ipAddress nullable
createdAt
```

### Invitation

```text
id
shopId
email
roleId
teamId nullable
invitedBy
tokenHash
expiresAt
acceptedAt
createdAt
```

### TicketCollaborator

For ekstern hjelp til én sak:

```text
id
ticketId
email
userId nullable
permissionLevel
invitedBy
tokenHash
expiresAt
revokedAt
createdAt
```

### AutomationRule

```text
id
shopId
name
trigger
conditionsJson
actionsJson
enabled
priority
createdAt
updatedAt
```

---

## 6. Authentication og agentportal

### 6.1 To innganger

Støtt:

1. Shopify Admin / merchant authentication.
2. Direkte supportportal med e-postbasert innlogging.

### 6.2 Passwordless e-post

MVP kan bruke magic links.

Krav:

- single-use
- kort levetid
- token lagres hashed
- rate limiting
- session revocation
- generiske svar som ikke avslører om e-post finnes
- sikre `httpOnly` cookies
- CSRF-beskyttelse
- passende SameSite-policy

Design for senere støtte av:

- passkeys
- Microsoft Entra ID
- Google Workspace
- SAML/enterprise SSO

### 6.3 Invitasjoner

Admin kan invitere agent med:

- navn
- e-post
- rolle
- team
- butikktilgang
- eventuell utløpsdato

### 6.4 Roller

Minimum:

- `OWNER`
- `ADMIN`
- `AGENT`
- `EXTERNAL_AGENT`
- `VIEWER`

Authorization skal baseres på permissions, ikke bare rollenavn.

### 6.5 Midlertidig ekstern tilgang

`EXTERNAL_AGENT` kan få:

- kun én butikk
- kun bestemte teams
- bare egne/teammets tickets
- begrenset Shopify-kontekst
- utløpsdato

Støtt field-level restrictions slik at eksterne agenter bare ser Shopify-data de faktisk trenger.

---

## 7. Ticket Inbox

Bygg en moderne support-inbox.

Filtre/køer:

- All
- New
- Mine
- Unassigned
- Waiting
- AI handled
- Needs review
- High priority
- Resolved

Ticket-listen bør vise:

- ticketnummer
- kunde
- subject
- kategori
- tidspunkt
- priority
- status
- assignee/team
- AI-status
- SLA-status

Ticketvisning:

- samtaletråd i hovedområdet
- composer for svar
- AI reply suggestion
- internal notes
- assignment/transfer
- tags
- followers
- attachments
- høyrepanel med Shopify-kontekst

---

## 8. Assignment, teams og overføring

Hver aktiv ticket kan ha én primær ansvarlig agent og eventuelt et team.

Støtt:

- Assign to me
- Assign to agent
- Assign to team
- Transfer
- Unassign
- Followers
- Internal notes
- `@mentions`

Ved overføring følger hele saken:

- samtale
- Shopify-kontekst
- vedlegg
- tags
- AI-summary
- interne notater
- historikk

### AI handover summary

Ved overføring kan AI generere:

- hva kunden ønsker
- hva som er gjort
- relevant ordre
- løfter gitt til kunden
- neste steg
- risikopunkter

### Collision detection

Design for presence:

- «Emma is viewing this ticket»
- «Emma is replying»

Unngå doble kundesvar.

### Agent availability

Design for:

```text
AVAILABLE
BUSY
AWAY
OFFLINE
```

Dette kan senere brukes til routing/load balancing.

---

## 9. Ekstern ekspert på én ticket

Implementer `Invite collaborator`.

En agent skal kunne invitere en ekstern ekspert til kun én sak.

Standard:

- kan lese nødvendig ticket-kontekst
- kan se eksplisitt tillatte vedlegg
- kan skrive interne kommentarer
- kan ikke browse andre tickets/kunder
- kan ikke svare kunden uten særskilt permission
- tilgang kan utløpe eller fjernes automatisk når saken lukkes

Eksempel:

```text
@ProductExpert Kan denne skaden dekkes av garantien?
```

Ekspertens interne svar kan deretter brukes som kontekst når AI foreslår kundesvar.

---

## 10. E-post

Inbound e-post er en kjernekanal.

Eksempel:

```text
support@merchant.no
→ inbound email provider
→ verified webhook
→ resolve shop
→ find/create customer
→ find/create ticket
→ create TicketMessage
→ enqueue AI processing
```

Bevar:

- `Message-ID`
- `In-Reply-To`
- `References`
- sender
- recipients
- CC der nødvendig
- plain text
- HTML
- attachments

Replies skal trådes på riktig ticket.

Outbound svar fra agent/AI skal sendes fra butikkens konfigurerte supportidentitet.

Implementer idempotency og retry-håndtering.

---

## 11. Storefront support

Etter e-post-MVP:

- support/contact form
- e-post
- subject
- melding
- optional order number
- attachment

Senere:

- chat-lignende widget
- authenticated customer context
- AI self-service før ticket opprettes

### Self-service flow

```text
Customer asks question
→ AI searches knowledge + allowed Shopify context
→ answer
→ "Løste dette problemet?"
   ├─ Ja → no ticket / resolved interaction
   └─ Nei → create ticket with full context
```

---

## 12. Shopify-integrasjon

Bruk Shopify Admin GraphQL API og minimum nødvendige scopes.

AI/agent skal ved behov kunne få autorisert kontekst om:

### Customer

- navn
- e-post
- språk
- relevante tidligere ordre
- relevante supporttickets

### Order

- ordrenummer
- dato
- line items
- payment status
- fulfillment
- tracking
- refund status
- cancellation status

### Product

- produkt
- variant
- beskrivelse
- eksplisitt relevante metafields

Eksempel:

```text
Customer: "Hvor er pakken min?"
→ identify customer
→ find relevant order
→ retrieve fulfillment/tracking
→ retrieve shipping knowledge
→ generate grounded response
```

Ikke vis sensitive ordredata bare fordi en bruker kjenner et ordrenummer. Identity/authorization må vurderes.

---

## 13. AI Knowledge: instrukser

Admin skal ha:

```text
AI → Instructions
```

Instruksjoner beskriver **hvordan AI skal opptre**, ikke bare faktakunnskap.

Støtt:

- generell supportinstruks
- tone of voice
- språk
- retur
- frakt
- reklamasjon
- produktspørsmål
- eskalering
- eksplisitte forbud

Eksempel:

```text
Svar kort og vennlig på norsk.
Bruk kundens fornavn når naturlig.
Ikke bruk emojis.
Lov aldri refusjon før policy tillater det.
Hvis kunden eksplisitt ber om et menneske, eskaler.
```

Støtt betingede instrukser:

```text
WHEN category = RETURN
→ use Returns instructions

WHEN sentiment = VERY_NEGATIVE
→ human approval required

WHEN customer.language = NO
→ Norwegian response rules
```

---

## 14. AI Knowledge: dokumentasjon

Admin skal ha:

```text
AI → Knowledge
```

Støtt gradvis:

- manuell artikkel
- ren tekst / Markdown
- PDF
- DOCX
- URL-import
- Shopify Pages
- Shopify Products
- FAQ
- senere eksterne kunnskapskilder

Dokumenter skal kunne:

- aktiveres/deaktiveres
- redigeres
- slettes
- erstattes
- tagges
- kategoriseres
- få gyldighetsperiode
- reindekseres
- vise sync-status

---

## 15. RAG-pipeline

Ikke send hele kunnskapsbasen til modellen.

Pipeline:

```text
Incoming customer message
        ↓
Resolve tenant/customer/ticket
        ↓
Classify intent/category
        ↓
Retrieve allowed Shopify context
        ↓
Semantic + metadata knowledge search
        ↓
Retrieve relevant chunks
        ↓
Apply merchant instructions
        ↓
Generate candidate response
        ↓
Validate grounding/policy/risk
        ↓
Automation decision
        ↓
AUTO SEND / HUMAN REVIEW / ESCALATE
```

Vector search skal alltid være tenant-filtrert.

Kunnskapskilder skal kunne spores tilbake til dokument og avsnitt/chunk.

---

## 16. Kildegrunnlag og «jeg vet ikke»

AI skal aldri finne på:

- ordrestatus
- trackingnummer
- returregler
- garantiregler
- refund status
- butikkspesifikke policies

Når kunnskapsgrunnlaget er utilstrekkelig:

```text
Confidence: LOW
Reason: No verified policy found for customised products.
Decision: ESCALATE
```

AI skal kunne si at den ikke har tilstrekkelig informasjon.

I agent-UI skal foreslått svar vise:

- confidence
- relevante Shopify-fakta
- knowledge sources
- validation warnings
- automation decision

Agent skal kunne åpne kilden som ble brukt.

---

## 17. AI Orchestrator

AI-prosesseringen bør deles i tydelige steg.

### Classification output

Bruk strukturert output:

```json
{
  "category": "SHIPPING",
  "priority": "NORMAL",
  "sentiment": "NEUTRAL",
  "urgency": 0.25,
  "requiresHuman": false,
  "language": "nb",
  "requestedActions": [],
  "confidence": 0.96
}
```

Kategorier kan inkludere:

- ORDER_STATUS
- SHIPPING
- RETURN
- REFUND
- CANCELLATION
- PRODUCT_QUESTION
- PAYMENT
- WARRANTY
- COMPLAINT
- ACCOUNT
- OTHER

### Context retrieval

Hent bare nødvendig Shopify- og knowledge-kontekst.

### Candidate response

Generer svar med eksplisitt source/context metadata.

### Validation

Et eget steg skal kontrollere svaret før utsending.

### Automation policy

Avgjør:

```text
AUTO_SEND
HUMAN_REVIEW
ESCALATE
NO_RESPONSE
```

---

## 18. AI Quality Control

Ikke stol på modellens egen confidence alene.

Bruk en kombinasjon av deterministiske regler og eventuell modellbasert evaluering.

Kontroller blant annet:

- Er sentrale fakta støttet av kilder?
- Stemmer ordre-/trackinginformasjon med Shopify-kontekst?
- Inneholder svaret påstander uten evidens?
- Bryter svaret business rules?
- Lover AI refund/cancellation uten tillatelse?
- Svarer teksten faktisk på kundens spørsmål?
- Krever saken menneskelig vurdering?

Pipeline:

```text
GENERATE
   ↓
VALIDATE
   ↓
POLICY CHECK
   ↓
SEND / REVIEW / ESCALATE
```

---

## 19. AI Modes

### Copilot

AI genererer utkast. Sender aldri automatisk.

### Assisted

AI kan sende automatisk når:

- kategori er tillatt
- confidence/validation er over terskel
- ingen policy/risk-regel blokkerer
- ingen write-action kreves

### Autopilot

AI håndterer tillatte kategorier automatisk og eskalerer unntak.

Merchant konfigurerer:

- AI mode
- allowed categories
- excluded categories
- confidence threshold
- risk rules

Start MVP i **Copilot**.

---

## 20. AI Actions

Arkitekturen skal støtte actions, men MVP skal være konservativ.

### Read actions

Eksempel:

```text
getCustomer
getOrder
getTracking
getProduct
getRelevantTickets
```

### Write actions

Eksempel:

```text
cancelOrder
refundOrder
editOrder
issueDiscount
changeAddress
createReturn
createReplacementOrder
```

I første MVP skal AI **ikke autonomt utføre finansielle eller irreversible Shopify-mutations**.

Senere skal hver action ha:

- explicit permission
- policy check
- idempotency
- human approval der nødvendig
- audit log
- action result
- rollback/compensation-strategi der mulig

---

## 21. Automation / Business Rules

Lag en regelmotor som på sikt kan håndtere:

```text
IF category = REFUND AND amount > threshold
THEN require manager approval

IF customer asks for human
THEN assign to agent

IF sentiment = VERY_NEGATIVE
THEN priority = HIGH AND disable auto-send

IF order.fulfilled = true
THEN cancellation action forbidden

IF customer has contacted support >= 3 times for same issue
THEN priority = HIGH
```

Ikke bygg en komplisert no-code editor i MVP, men design datamodellen for det.

---

## 22. Eskalering

AI skal eskalere når:

- kunden ber om menneske
- kunnskapsgrunnlaget er utilstrekkelig
- confidence/validation er lav
- svært negativ sentiment
- juridisk/chargeback-relatert problem
- sensitiv betalingssak
- uvanlig høy ordreverdi etter merchant-regel
- flere AI-forsøk ikke løser saken
- write-action krever godkjenning
- policy krever menneske

Vis eksplisitt **hvorfor** saken ble eskalert.

---

## 23. Customer Timeline

Lag en samlet tidslinje:

```text
Today
💬 Asked about delayed delivery

30 Aug
📦 Order #1842 shipped

28 Aug
🛒 Order #1842 placed

14 Jun
💬 Return ticket #892 resolved
```

Kombiner relevant supporthistorikk og Shopify-hendelser.

AI skal kunne bruke autorisert relevant historikk som kontekst.

---

## 24. Duplicate detection og merging

Identifiser sannsynlige duplikater basert på:

- samme kunde
- nærliggende tidspunkt
- subject
- semantic similarity
- order number
- email threading

Agent kan merge tickets.

Bevar full audit history.

---

## 25. Intern dialog og samarbeid

Støtt:

- internal notes
- `@mentions`
- followers
- agent/team assignment
- transfer reason
- AI handover summary
- notifications

Interne kommentarer skal aldri sendes til kunden eller inkluderes ukritisk i kundesvar. Marker visibility eksplisitt.

---

## 26. Notifications

Varsle ved:

- ticket assigned
- ticket transferred
- `@mention`
- customer reply
- AI escalation
- critical ticket
- SLA nearing breach
- collaborator invitation

Start med in-app + e-post der hensiktsmessig. Design provider-abstraksjon for senere kanaler.

---

## 27. SLA

Design for:

- first response SLA
- resolution SLA
- priority-specific targets
- business hours senere
- pause ved `WAITING_FOR_CUSTOMER`
- warnings
- overdue state

Inbox skal kunne sorteres etter SLA-risiko.

---

## 28. Sentiment, urgency og VIP

AI kan klassifisere:

- sentiment
- urgency
- complaint severity

Merchant-regler kan bruke Shopify-/supportdata til prioritering.

Ikke bruk sensitive personopplysninger til profilering eller prioritering.

---

## 29. Knowledge Gap Detection

Registrer saker hvor AI mangler dokumentasjon eller mennesket korrigerer svaret.

Aggreger mønstre:

```text
12 customers asked about customised returns
8 customers asked about shipping to Sweden
6 customers asked about changing an order
```

Admin kan velge:

`Generate knowledge article`

AI kan lage utkast basert på **godkjente** menneskelige svar, men artikkelen må godkjennes før publisering.

---

## 30. Feedback loop

På AI-svar:

- thumbs up
- thumbs down

Hvis agent redigerer et forslag, lagre på en personvernbevisst måte:

- AI candidate
- final response
- relevante metadata

Bruk dette til evaluering og forbedring, ikke automatisk modelltrening uten eksplisitt beslutning/policy.

---

## 31. AI Test Center

Bygg før full Autopilot.

Admin kan teste et scenario uten å sende noe:

```text
Input:
"Skoene gikk i stykker etter tre måneder.
Kan jeg få pengene tilbake?"

Category: WARRANTY
Sources: Warranty Policy §4
Confidence: 93%
Decision: HUMAN_REVIEW
Reason: Refund requires approval
```

Senere: replay av historiske tickets mot ny konfigurasjon.

Rapporter:

- would auto-resolve
- would escalate
- validation success
- policy violations
- missing knowledge
- estimated AI cost

Ingen replay skal sende e-post eller utføre Shopify-actions.

---

## 32. Proaktiv kundeservice

Senere fase.

Eksempel:

```text
Tracking unchanged for 5 days
→ identify affected orders
→ create proactive support campaign/proposals
→ merchant approves
→ personalised customer updates
```

Ikke implementer autonom masseutsending i MVP.

---

## 33. Incident Mode

Design for massehendelser.

Eksempel:

`Incident: Carrier delivery delays`

Systemet kan senere:

- gruppere relaterte tickets
- bruke godkjent incident-kontekst
- vise antall berørte kunder
- foreslå bulk update
- automatisk relatere nye tickets
- lukke incident når ferdig

---

## 34. Spam og sikker behandling av innhold

Inbound content er untrusted.

Håndter:

- spam
- phishing
- auto-replies
- mailing-list noise
- farlige vedlegg
- HTML sanitization
- prompt injection

Kunde-e-post, dokumenter og nettsider skal aldri kunne overstyre system-/merchant-policy eller instruere AI til å hente data den ikke er autorisert til.

---

## 35. Webhooks og event processing

For Shopify og e-post:

- signature/HMAC verification
- idempotency
- duplicate detection
- retries
- dead-letter handling
- structured logging

Bruk background jobs for langsomme operasjoner:

- AI calls
- embeddings
- document parsing
- sync
- e-post
- analytics aggregation

HTTP webhook-handler skal returnere raskt etter sikker validering og enqueue.

---

## 36. Personvern og sikkerhet

Design for GDPR og Shopify-krav.

Minimum:

- least-privilege Shopify scopes
- krypter tokens/secrets
- secure sessions
- tenant isolation
- audit logging
- data retention
- data export
- data deletion/redaction
- nødvendige Shopify compliance webhooks
- tilgangsrevokering
- ingen secrets i logger
- masking av sensitive data
- principle of least privilege for external agents

Verifiser gjeldende Shopify App Store- og privacy-krav ved implementering.

---

## 37. Audit Log

Logg sikkerhets- og forretningskritiske hendelser:

- login
- failed login der relevant
- user invited
- invitation accepted
- membership added/removed
- role/permission change
- ticket assignment/transfer
- external collaborator invited
- customer/order data access der nødvendig
- AI auto-send
- AI escalation
- Shopify action proposed
- Shopify action approved
- Shopify action executed
- knowledge changed
- automation rule changed

Audit events skal være append-only for vanlige brukere.

---

## 38. Dashboard og Analytics

MVP/basic:

- open tickets
- tickets today
- first response time
- resolution time
- tickets by category
- AI handled
- AI escalated

Senere:

### AI Resolution Rate

```text
tickets fully resolved by AI / eligible tickets
```

### AI metrics

- AI suggestion acceptance
- edit rate
- auto-send rate
- escalation rate
- validation failures
- knowledge gaps

### Support metrics

- agent workload
- SLA compliance
- category volume
- CSAT
- sentiment

### AI cost

Logg:

- tokens
- model
- estimated cost
- cost per ticket
- cost per AI-resolved ticket

### ROI

Estimer:

- agent hours saved
- support cost saved
- automation rate

Ikke presenter spekulative besparelser som eksakte fakta. Gjør antakelser konfigurerbare og transparente.

---

## 39. Customer Satisfaction

Etter løst sak kan kunden få enkel CSAT:

```text
Hvordan vil du vurdere hjelpen?
😞  😐  🙂  😄
```

Koble til:

- ticket
- agent/AI
- category
- response/resolution time
- automation mode

---

## 40. Merchant Settings

### AI

- enabled
- mode
- confidence threshold
- allowed categories
- excluded categories

### Voice & tone

Fritekst og strukturerte innstillinger.

### Knowledge

- instructions
- documents
- sync sources

### Email

- inbound address
- sender identity
- signature

### Team

- users
- invitations
- roles
- teams
- permissions

### Notifications

- critical ticket
- assignment
- negative sentiment
- escalation
- SLA

### Security

- sessions
- revoke access
- external access expiry
- audit log

---

## 41. Informasjonshierarki for AI

Bruk følgende konseptuelle prioritet:

```text
1. Platform security / immutable system policies
2. Merchant AI instructions and explicit business rules
3. Verified live Shopify facts
4. Merchant knowledge base
5. Relevant verified prior support context
6. Customer's current message
```

Dette betyr ikke at merchant-instruksjoner kan endre faktiske Shopify-data. Konflikter skal håndteres eksplisitt og sikkert.

---

## 42. MVP: vertikal end-to-end flyt

Første mål:

```text
Shopify install
      ↓
Configure shop
      ↓
Invite support agent
      ↓
Inbound customer email
      ↓
Ticket created
      ↓
Customer matched
      ↓
Relevant Shopify order context retrieved
      ↓
Relevant knowledge retrieved
      ↓
AI draft generated
      ↓
Validation
      ↓
Human agent reviews
      ↓
Agent edits/approves
      ↓
Outbound email
      ↓
Customer replies
      ↓
Same ticket thread
```

Dette må fungere stabilt før Autopilot, chat, advanced analytics eller write-actions bygges.

---

## 43. Utviklingsfaser

### Phase 0 — Foundation

- inspect repository
- architecture decisions
- environment/config
- DB schema
- tenant model
- authentication model
- authorization framework
- logging
- error handling
- job queue
- test strategy

### Phase 1 — Core MVP

- Shopify install/OAuth
- Shop + ShopifyInstallation
- direct agent login
- invitations
- RBAC
- basic team management
- ticket/customer/message models
- inbox
- inbound e-mail
- outbound e-mail
- threading
- Shopify customer lookup
- Shopify order lookup
- manual knowledge articles
- chunking/embeddings
- tenant-safe RAG
- AI classification
- AI reply draft
- source display
- AI validation
- human approval
- ticket status
- assignment/transfer
- internal notes
- basic audit log

**Exit criterion:** Hele vertikale flyten fungerer uten mock-data.

### Phase 2 — Support Operations

- teams
- followers
- @mentions
- notifications
- external agents
- ticket collaborator
- AI handover summary
- tags
- sentiment
- priority
- AI conversation summary
- attachments
- duplicate detection
- merging
- customer timeline
- SLA basics

### Phase 3 — Knowledge & Assisted AI

- PDF/DOCX ingestion
- URL ingestion
- Shopify Pages/Products sync
- conditional instructions
- knowledge management UI
- knowledge gaps
- agent feedback loop
- AI Test Center
- Assisted mode
- configurable confidence/policy thresholds
- advanced validation

### Phase 4 — Storefront & Automation

- storefront support form
- self-service AI
- customer account integration where appropriate
- automation rules
- advanced routing/load balancing
- incident mode
- proactive support foundations

### Phase 5 — Controlled Actions

- action framework
- human approvals
- refund/cancellation/etc. integrations
- granular action permissions
- deterministic guardrails
- idempotency
- full action audit
- Autopilot for explicitly approved scenarios

### Phase 6 — SaaS Scale

- billing
- plan/usage limits
- advanced analytics
- CSAT
- AI cost/ROI
- SSO
- enterprise controls
- advanced observability
- data retention configuration
- operational tooling

---

## 44. Teststrategi

Minimum:

### Unit tests

- authorization
- tenant filtering
- ticket state transitions
- assignment
- email threading
- automation rules
- AI policy decisions
- knowledge filtering

### Integration tests

- Shopify API adapters
- e-mail webhooks
- outbound e-mail
- DB
- vector retrieval
- background jobs

### Security tests

- cross-tenant access
- permission escalation
- expired invitations
- collaborator scope
- webhook forgery
- replay/idempotency
- prompt injection scenarios

### AI evaluations

Lag et eval-sett med representative supportsaker:

- order status
- returns
- warranty
- complaints
- ambiguous questions
- missing knowledge
- adversarial/prompt injection
- human-request
- risky actions

Evaluer:

- factual grounding
- correct category
- correct escalation
- policy compliance
- source relevance
- unsupported claims
- language/tone

AI-endringer skal ikke vurderes bare ut fra «ser bra ut».

---

## 45. Observability

Bruk strukturert logging med correlation IDs.

Mål:

- webhook processing
- job failures
- email delivery
- AI latency
- AI errors
- Shopify API failures
- vector search latency
- ticket processing latency
- token/cost usage

Ikke logg secrets eller unødvendige persondata.

---

## 46. UX-prinsipper

Agenten skal kunne løse mest mulig fra én skjerm.

Ticketvisningen bør prioritere:

1. Kundens siste melding.
2. AI-forslag og eventuelle warnings.
3. Svarfelt.
4. Relevant Shopify-kontekst.
5. Kilder AI brukte.
6. Assignment/team/status.
7. Intern historikk.

Unngå å overlesse UI med all Shopify-data. Vis relevant kontekst og tilby drill-down.

---

## 47. Coding standards

- TypeScript strict mode.
- Strong typing.
- Små, fokuserte moduler.
- Ingen business logic i presentasjonskomponenter.
- Server-side authorization på alle sensitive operasjoner.
- Tenant filtering i repository/service-lag.
- Schema validation på ekstern input.
- Sanitise HTML.
- Idempotency for webhooks/actions.
- Migrations skal være reviewable.
- Secrets kun via sikker config/environment.
- Ikke hardkod provider-spesifikke AI-modeller gjennom domenelaget.
- Feature flags for risikable/ufullførte funksjoner.
- Ikke la TODO-er skjule sikkerhetskritisk funksjonalitet.

---

## 48. Definition of Done per feature

En feature er ikke ferdig før den har:

1. datamodell/migration der nødvendig
2. authorization
3. service/domain logic
4. API/route
5. UI der relevant
6. validation
7. error handling
8. audit/logging der relevant
9. tests
10. tenant isolation test
11. dokumentasjon
12. typecheck/lint/test grønt

---

## 49. Instruks til Codex / Claude Code

Når du får dette dokumentet:

### Før du skriver større mengder kode

1. Inspiser hele eksisterende repository.
2. Identifiser framework, dependencies og eksisterende mønstre.
3. Ikke overskriv fungerende kode uten grunn.
4. Verifiser gjeldende Shopify API/anbefalinger fra offisiell dokumentasjon dersom nett-tilgang er tilgjengelig.
5. Lag eller oppdater:
   - `ARCHITECTURE.md`
   - `ROADMAP.md`
   - `SECURITY.md`
   - `.env.example`
6. Foreslå endelig database schema.
7. Foreslå folder structure.
8. Identifiser nødvendige secrets/environment variables.
9. Lag en konkret MVP-taskliste med avhengigheter.
10. Identifiser arkitekturbeslutninger som må tas før implementering.

### Implementeringsrekkefølge

Ikke forsøk å bygge hele roadmapet i ett pass.

Start med Phase 0 og Phase 1.

Prioriter den vertikale flyten:

```text
Shopify installation
→ Agent authentication
→ Incoming email
→ Ticket
→ Customer/order context
→ Knowledge retrieval
→ AI draft
→ Validation
→ Human approval
→ Outbound reply
```

### Etter hver milepæl

Kjør:

- typecheck
- lint
- unit tests
- relevante integration tests

Rett feil før neste milepæl.

### Ved usikkerhet

- Ikke gjett på Shopify API-kontrakter.
- Ikke gjett på security-sensitive implementation.
- Ikke omgå permissions for å «få det til å virke».
- Dokumenter antakelser.
- Foretrekk minste sikre implementasjon.
- Spør om produktbeslutninger bare når de faktisk blokkerer videre arbeid.

---

## 50. Ikke bygg dette for tidlig

Følgende er viktige, men skal ikke blokkere MVP:

- full chat-widget
- avansert no-code automation builder
- autonom refund/cancellation
- avansert load balancing
- incident automation
- proactive bulk messaging
- enterprise SSO
- avansert ROI-dashboard
- full billing/plan engine
- komplekst custom-role UI

Design for dem, men få først kjerneflyten stabil.

---

## 51. Produktets viktigste differensiatorer

Arkitekturen skal bevare disse fire egenskapene:

### 1. Shopify-aware AI

AI svarer med faktiske, autoriserte ordre-/kunde-/produktdata når relevant, ikke bare generelle FAQ-svar.

### 2. Merchant-owned knowledge

AI bruker butikkens egne instrukser, policies og dokumentasjon med sporbare kilder.

### 3. Safe progressive autonomy

Merchant kan gå fra Copilot til Assisted til Autopilot basert på målbar kvalitet og eksplisitte guardrails.

### 4. Resolution, not response

Produktet optimaliseres på sikt for å **løse kundeproblemet**, ikke bare generere tekst.

---

## 52. North-star metrics

Prioriter følgende målinger:

- AI Resolution Rate
- Human Escalation Rate
- AI Suggestion Acceptance Rate
- Unsupported Claim / Validation Failure Rate
- First Response Time
- Resolution Time
- CSAT
- Cost per Resolved Ticket
- Knowledge Gap Rate

Sikkerhet og svarkvalitet skal veie tyngre enn høyest mulig automation rate.

---

## 53. Første konkrete leveranse

Første utviklingsleveranse skal være et kjørbart fundament hvor:

- én Shopify-butikk kan installere appen
- en admin kan invitere en agent via e-post
- agenten kan logge inn uten Shopify
- en kunde kan sende e-post til support
- e-posten oppretter/tråder en ticket
- ticketen vises i inbox
- kunden matches mot Shopify når mulig
- relevant ordreinfo vises
- admin kan legge inn AI-instruksjoner og kunnskapsartikler
- AI finner relevante knowledge chunks
- AI lager et kildebasert svarutkast
- validering/policy avgjør at menneske må godkjenne i MVP
- agenten kan redigere og sende
- kundens neste svar havner på samme ticket
- ticket kan overføres til en annen agent
- relevante hendelser auditeres

**Ikke aktiver automatisk utsending før denne flyten er stabil, testet og målbar.**
