import type { ActionFunctionArgs } from "react-router";
import crypto from "node:crypto";
import db from "../../db.server";
import { SenderType } from "@prisma/client";
import { findOrCreateCustomerByEmail, findOrCreateTicketFromEmail } from "../../services/ticket.service.server";
import { logAuditEvent } from "../../services/audit.service.server";

// Postmark does not sign inbound webhooks; it supports Basic Auth embedded in the
// webhook URL instead: https://postmark:<EMAIL_INBOUND_WEBHOOK_SECRET>@<host>/webhooks/email/inbound
function verifyWebhookAuth(request: Request): boolean {
  const secret = process.env.EMAIL_INBOUND_WEBHOOK_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV !== "production") {
      console.warn("[email:webhook] EMAIL_INBOUND_WEBHOOK_SECRET not set — skipping auth in dev");
      return true;
    }
    return false;
  }
  const header = request.headers.get("authorization") ?? "";
  if (!header.startsWith("Basic ")) return false;
  const password = Buffer.from(header.slice(6), "base64").toString("utf8").split(":").slice(1).join(":");
  const expected = Buffer.from(secret);
  const actual = Buffer.from(password);
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

type ResolvedShop = { id: string; name: string; domain: string };

// Mail forwarded from a shop's own address (e.g. support@liltracker.no) keeps that
// address in To/Cc, so it is the most specific way to pick the shop.
async function resolveShopFromSupportEmail(recipients: string[]): Promise<ResolvedShop | null> {
  if (recipients.length === 0) return null;
  return db.shop.findFirst({ where: { supportEmail: { in: recipients }, status: "ACTIVE" } });
}

// `abc123+cronus-jens@inbound.postmarkapp.com` → MailboxHash "cronus-jens" → cronus-jens.myshopify.com
async function resolveShopFromMailboxHash(mailboxHash: string): Promise<ResolvedShop | null> {
  const handle = mailboxHash.trim().toLowerCase().replace(/[^a-z0-9.-]/g, "");
  if (!handle) return null;
  const domain = handle.includes(".") ? handle : `${handle}.myshopify.com`;
  return db.shop.findFirst({ where: { domain, status: "ACTIVE" } });
}

async function resolveShopFromRecipient(recipient: string): Promise<ResolvedShop | null> {
  const domain = recipient.split("@")[1]?.toLowerCase().replace(/[^a-z0-9.-]/g, "");
  if (!domain) return null;
  const shop = await db.shop.findFirst({ where: { domain, status: "ACTIVE" } });
  if (shop) return shop;
  return db.shop.findFirst({ where: { domain: { contains: domain }, status: "ACTIVE" } });
}

export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const rawBody = await request.text();
  if (!verifyWebhookAuth(request)) return new Response("Unauthorized", { status: 401 });
  let payload: Record<string, unknown>;
  try { payload = JSON.parse(rawBody) as Record<string, unknown>; }
  catch { return new Response("Invalid JSON", { status: 400 }); }

  const fromEmail = String((payload["FromFull"] as { Email?: string } | undefined)?.Email ?? payload["From"] ?? "").trim().toLowerCase();
  const fromName = String((payload["FromFull"] as { Name?: string } | undefined)?.Name ?? "").trim() || null;
  const toEmails: string[] = [];
  const toFull = payload["ToFull"] as Array<{ Email?: string }> | undefined;
  if (Array.isArray(toFull)) { for (const e of toFull) { if (e.Email) toEmails.push(e.Email.trim().toLowerCase()); } }
  else if (payload["To"]) toEmails.push(String(payload["To"]).trim().toLowerCase());
  const ccFull = payload["CcFull"] as Array<{ Email?: string }> | undefined;
  const ccEmails = Array.isArray(ccFull) ? ccFull.flatMap((e) => (e.Email ? [e.Email.trim().toLowerCase()] : [])) : [];

  const subject = String(payload["Subject"] ?? "No subject").trim();
  const bodyText = String(payload["TextBody"] ?? payload["Body"] ?? "").trim();
  const bodyHtml = payload["HtmlBody"] ? String(payload["HtmlBody"]).trim() : null;
  // Postmark's top-level MessageID is its own UUID; the RFC 5322 threading headers
  // (Message-ID, In-Reply-To, References) are in the Headers array.
  const headerList = Array.isArray(payload["Headers"]) ? (payload["Headers"] as Array<{ Name?: string; Value?: string }>) : [];
  const headerValue = (name: string) =>
    headerList.find((h) => h.Name?.toLowerCase() === name.toLowerCase())?.Value?.trim() || null;
  const messageId = headerValue("Message-ID") ?? (payload["MessageID"] ? String(payload["MessageID"]).trim() : null);
  const inReplyTo = headerValue("In-Reply-To") ?? (payload["InReplyTo"] ? String(payload["InReplyTo"]).trim() : null);
  const references = headerValue("References") ?? (payload["References"] ? String(payload["References"]).trim() : null);

  if (!fromEmail) return new Response("Missing sender email", { status: 400 });
  if (!bodyText && !bodyHtml) return new Response("Missing email body", { status: 400 });

  const mailboxHash = String(payload["MailboxHash"] ?? "").trim();
  let shop = await resolveShopFromSupportEmail([...toEmails, ...ccEmails]);
  if (!shop && mailboxHash) shop = await resolveShopFromMailboxHash(mailboxHash);
  if (!shop) {
    for (const to of toEmails) { shop = await resolveShopFromRecipient(to); if (shop) break; }
  }
  if (!shop) {
    console.warn("[email:webhook] Could not resolve shop from recipients:", toEmails, "mailboxHash:", mailboxHash);
    return new Response("OK", { status: 200 });
  }

  const customer = await findOrCreateCustomerByEmail({
    shopId: shop.id, email: fromEmail,
    firstName: fromName?.split(" ")[0] ?? null,
    lastName: fromName?.split(" ").slice(1).join(" ") || null,
  });

  const { ticket, isNew } = await findOrCreateTicketFromEmail({
    shopId: shop.id, customerId: customer.id, subject, inReplyTo, messageId,
  });

  const message = await db.ticketMessage.create({
    data: {
      ticketId: ticket.id, senderType: SenderType.CUSTOMER,
      body: bodyText || "(no text body)",
      bodyHtml: bodyHtml ?? undefined,
      messageId: messageId ?? undefined,
      inReplyTo: inReplyTo ?? undefined,
      references: references ?? undefined,
      isIncoming: true,
    },
  });

  await db.ticket.update({
    where: { id: ticket.id },
    data: {
      lastMessageAt: new Date(),
      ...(ticket.status === "RESOLVED" || ticket.status === "CLOSED" ? { status: "OPEN", aiStatus: "PENDING" } : {}),
    },
  });

  await logAuditEvent({
    shopId: shop.id, entityType: "ticket", entityId: ticket.id,
    eventType: isNew ? "email.inbound.new_ticket" : "email.inbound.reply",
    details: { from: fromEmail, subject, messageId, ticketNumber: ticket.ticketNumber, messageDbId: message.id },
    ticketId: ticket.id,
  });

  console.log(`[email:webhook] ${isNew ? "Created" : "Updated"} ticket ${ticket.ticketNumber} from ${fromEmail}`);
  return new Response("OK", { status: 200 });
};

