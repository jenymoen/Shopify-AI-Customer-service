# Testguide

Manuell QA-guide for funksjonalitet som faktisk er bygget, basert på koden i `app/` — ikke på
planen i `TODO.md`. Det finnes ingen automatisert testsuite ennå (se «Ikke testet ennå» nederst),
så dette er stegene for å verifisere hver flyt for hånd i dev.

**Vedlikehold:** Denne filen oppdateres fortløpende etter hvert som nye funksjoner bygges —
spesielt Fase 5 (AI Actions), som er under arbeid nå. Når en seksjon er merket
`🚧 Under arbeid`, er den ikke ferdig testbar ennå.

---

## 1. Oppsett

```bash
npm install
cp .env.example .env   # fyll inn DATABASE_URL, SESSION_SECRET, ENCRYPTION_KEY, TOKEN_HASH_SECRET minimum
npx prisma migrate dev
npm run dev             # react-router dev, kjører appen mot Shopify partner-appen
```

For rask lokal iterasjon uten en ekte Shopify-butikk kobler flere loaders seg til
`authenticateAdminOrFallback` / `readPortalSessionCookie` og faller tilbake til første
`ShopMembership` i databasen når det ikke finnes en ekte sesjon — så en `shop` + `user` +
`shopMembership` rad holder for å teste admin- og portal-sidene uten full OAuth-handshake.

AI-funksjoner (orkestrator, test-center) krever `ANTHROPIC_API_KEY` eller `GEMINI_API_KEY`;
uten noen av delene faller orkestratoren tilbake til en lokal mal-tekst (`local-template`) —
det er forventet, ikke en feil.

Sjekk alltid `npx tsc --noEmit` (eller `npm run typecheck`) etter endringer — det er nærmeste vi
har til en automatisk gate akkurat nå.

---

## 2. Autentisering & tilgang (Fase 1.1–1.2)

- **Shopify install/OAuth**: `npm run dev:shopify` → installer appen på en dev-butikk →
  bekreft at `Shop` og `ShopifyInstallation` opprettes (`ensureShopForSession` i
  `shop.service.server.ts`), og at `accessTokenEncrypted` er kryptert (ikke klartekst) i DB.
- **Agent magic-link login**: gå til `/portal/login`, skriv inn en e-post → i dev vises
  magic-link-URL-en direkte på siden (ingen faktisk e-post sendes) → klikk den → skal lande på
  `/portal/dashboard` innlogget.
  - Prøv samme flyt for en e-post som **ikke** har noen konto/invitasjon — svaret skal se likt
    ut som for en gyldig e-post (ingen brukeropplysning om hvorvidt kontoen finnes).
- **Invitasjon** (`/app/invite`, krever `USERS_WRITE`): opprett en invitasjon med rolle
  `AGENT`, sjekk at den dukker opp under «Pending invitations» med riktig utløpsdato, og at
  `logAuditEvent` skriver `invitation.created`. Test «Revoke» → status blir `REVOKED`.
- **RBAC**: logg inn som en bruker med rolle `VIEWER` eller `EXTERNAL_AGENT` og bekreft at
  sider som krever `TICKETS_INTERNAL_NOTE`/`USERS_WRITE`/`KNOWLEDGE_WRITE` gir 403
  (`hasPermission` i `authorization.server.ts`).

## 3. Ticket Inbox & ticketvisning (Fase 1.4, 1.10)

- `/app/inbox` (merchant-admin-siden): bytt mellom filtrene (`all`, `new`, `mine`,
  `unassigned`, `waiting`, `ai_handled`, `needs_review`, `high_priority`, `resolved`) og
  bekreft at listen faktisk filtreres riktig mot ticket-status/aiStatus/priority.
- `/portal/ticket/:id` (agent-arbeidsflaten):
  - Skriv et svar i «Reply to Customer» → send → ny `TicketMessage` med `senderType: AGENT`
    vises øverst i tråden, og `AuditEvent` `ticket.message.sent` logges.
  - Legg til en internal note (kun synlig hvis `canManageInternalNotes`) → bekreft den vises i
    den gule «Internal Notes»-boksen og aldri sendes til kunden.
  - Endre status/assignee/priority i høyre panel → «Update Properties» → bekreft
    `AssignmentHistory`-rader opprettes for hver endring (`updateTicketAssignmentAndStatus`).
  - Følg/avfølg ticket («☆ Follow ticket») → `TicketFollower` opprettes/slettes.

## 4. E-post inn/ut (Fase 1.5)

- Post en simulert Postmark-webhook mot `/webhooks/email/inbound` (uten
  `EMAIL_WEBHOOK_SECRET` satt i dev godtas alt, med varsel i konsollen) med et JSON-body som
  inneholder `FromFull.Email`, `ToFull`, `Subject`, `TextBody`.
  - Første gang: bekreft ny `Customer` + `Ticket` (status `NEW`) + `TicketMessage`
    (`isIncoming: true`) opprettes, og at `To`-mottakeren matches til riktig `Shop` via
    domenet i e-postadressen (`resolveShopFromRecipient`).
  - Send en oppfølging med samme `InReplyTo`/`References` som pekte melding → bekreft den
    havner på **samme** ticket i stedet for å opprette en ny (tråding via `messageId`).
  - Send til en ticket som er `RESOLVED`/`CLOSED` → bekreft den gjenåpnes til `OPEN` og
    `aiStatus` nullstilles til `PENDING`.

## 5. Shopify-kontekst i ticket (Fase 1.6)

- Åpne en ticket der kundens e-post matcher en reell kunde i den tilkoblede dev-butikken →
  bekreft «Shopify Customer»-kortet og «Recent Orders»-kortet i `/portal/ticket/:id` fylles ut
  korrekt (`lookupShopifyCustomerByEmail` / `lookupShopifyOrdersByEmail`).
- Test med en kunde-e-post som **ikke** finnes i butikken → bekreft fallback-teksten «No
  direct Shopify customer record matched» vises i stedet for en feil.

## 6. AI Knowledge & instruksjoner (Fase 1.7–1.9, 3)

- `/app/ai/instructions`: opprett instrukser av ulike typer (`GENERAL`, `RETURNS`, osv.) med
  og uten `conditions` (f.eks. `{ "category": "RETURNS" }`) → bekreft
  `matchesInstructionConditions` filtrerer riktig når orkestratoren kjøres på en ticket i den
  kategorien vs. en annen.
- `/app/ai/knowledge`: test alle tre kilder — manuell artikkel, URL-scraping (`ingest-url`),
  og «Sync Shopify Pages»/«Sync Shopify Products» — og bekreft at hvert dokument får
  `KnowledgeChunk`-rader med embeddings (`chunkAndEmbedDocument`) og dukker opp i søk.
- I en ticket, trykk «✨ Generate AI Draft» → bekreft et `AIExecution`-objekt opprettes med
  `decision: HUMAN_REVIEW` (Copilot-modus er MVP-standard) og forslaget vises i den grønne
  boksen med «Human Review Required»-badge. Trykk «Approve & Send to Customer» → forslaget
  sendes som en vanlig agent-melding.
- `/app/ai/test-center`: kjør et par eksempelspørsmål («Can I return my order if I opened the
  box?») i sandkasse-modus → bekreft **ingen** e-post sendes og **ingen** ticket opprettes,
  bare kategori/konfidens/kilder/beslutning vises. Prøv uten noen AI-nøkkel satt → bekreft
  den forklarende feilmeldingen (mangler `GEMINI_API_KEY`/ugyldig nøkkel) vises i stedet for
  et rått stack trace.

## 7. Automation, Incidents, Teams (Fase 2, 4)

- `/app/automation`: opprett en regel («Subject contains "Urgent"» → sett prioritet `URGENT`
  + tildel et team) → opprett en ny ticket med det ordet i emnet (via e-post-webhook eller
  `/portal/dashboard` → «Create Ticket») → bekreft regelen faktisk kjørte
  (`automation-rules.server.ts`, trigger `TICKET_CREATED`).
- `/app/incidents`: deklarer et incident med nøkkelord → bekreft matchende åpne tickets
  auto-lenkes (`IncidentTicket`) → «Resolve & Bulk Close» → bekreft alle lenkede tickets får
  status endret og incident settes til `RESOLVED`.
- `/app/teams`: opprett team, legg til/fjern medlemmer → bekreft `TeamMembership` og at
  ticket-tildeling til teamet fungerer fra `/portal/ticket/:id`.

## 8. Storefront self-service (Fase 4)

- `POST /api/storefront/support` med `intent: "self_service_check"` og en kundespørring som
  matcher et knowledge-dokument → bekreft `suggestedSolution` + `sourceTitle` returneres.
- Samme endepunkt uten treff, deretter et vanlig kall uten `intent` (oppretter ticket) →
  bekreft `ticketNumber` returneres og en `Ticket` med `source: STOREFRONT` opprettes.

## 9. Fase 5 — AI Actions (Controlled Actions) 🚧 Under arbeid

Denne seksjonen fylles ut etter hvert som rammeverket for styrte AI-handlinger
(`ActionPolicy`/`ActionExecution`, se `app/services/actions/`) blir kjørbart. Planlagt
dekning når klart:

- Policy-administrasjon (`/app/ai/actions`): aktivere/deaktivere en handlingstype, sette
  krav om godkjenning, og eksplisitt aktivere autopilot for én handlingstype av gangen.
- Read actions (`getCustomer`, `getOrder`, `getTracking`, `getProduct`,
  `getRelevantTickets`) — kjører uten godkjenning, men logges og er idempotente.
- Write actions (`cancelOrder`, `refundOrder`, `editOrder`, `issueDiscount`,
  `changeAddress`, `createReturn`, `createReplacementOrder`) — verifisere at:
  - et forsøk fra en `VIEWER`/`EXTERNAL_AGENT`-bruker avvises (403/guardrail),
  - en foreslått handling havner som `PENDING_APPROVAL` og vises i «Pending Actions» på
    ticketen,
  - godkjenning av en `OWNER`/`ADMIN` faktisk utfører Shopify-mutasjonen og setter status til
    `SUCCEEDED`/`FAILED` basert på ekte svar,
  - samme forespørsel sendt to ganger med samme idempotency-nøkkel ikke dobbeltkjører,
  - hver overgang (`proposed`/`approved`/`rejected`/`executed`/`failed`) skriver en
    `AuditEvent`.

## Ikke testet ennå / kjente hull

- Ingen automatisert unit-/integrasjons-/sikkerhetstest-suite (se `TODO.md` §44) —
  alt over er manuelt.
- Ingen CI-gate som kjører `typecheck`/`lint` automatisk ved commit i dette repoet ennå.
- Prompt injection-, webhook-forgery- og cross-tenant-isolasjonstester er ikke satt opp.
