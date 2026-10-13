import { SenderType } from "@prisma/client";
import db from "../db.server";
import { findOrCreateCustomerByEmail, findOrCreateTicketFromEmail } from "./ticket.service.server";
import { logAuditEvent } from "./audit.service.server";

export type InboundEmail = {
  fromEmail: string;
  fromName: string | null;
  toEmails: string[];
  ccEmails: string[];
  /** Plus-address tag, e.g. `abc+cronus-jens@inbound...` -> "cronus-jens". */
  mailboxHash?: string | null;
  subject: string;
  bodyText: string;
  bodyHtml: string | null;
  messageId: string | null;
  inReplyTo: string | null;
  references: string | null;
  attachments?: InboundAttachment[];
};

export type InboundAttachment = {
  /** Where the bytes can be fetched later, e.g. "resend:<email id>:<attachment id>". */
  storageKey: string;
  filename: string;
  contentType: string;
  sizeBytes: number | null;
};

export type InboundResult =
  | { status: "created" | "reply"; ticketNumber: string }
  | { status: "duplicate" }
  | { status: "no_shop" };

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

/** Shared by every inbound provider: resolve the shop, thread into a ticket, store the message. */
export async function processInboundEmail(email: InboundEmail): Promise<InboundResult> {
  const mailboxHash = (email.mailboxHash ?? "").trim();
  let shop = await resolveShopFromSupportEmail([...email.toEmails, ...email.ccEmails]);
  if (!shop && mailboxHash) shop = await resolveShopFromMailboxHash(mailboxHash);
  if (!shop) {
    for (const to of email.toEmails) {
      shop = await resolveShopFromRecipient(to);
      if (shop) break;
    }
  }
  if (!shop) {
    console.warn("[email:inbound] Could not resolve shop from recipients:", email.toEmails, "mailboxHash:", mailboxHash);
    return { status: "no_shop" };
  }

  // Providers retry failed deliveries, so the same Message-ID must not create a second message.
  if (email.messageId) {
    const existing = await db.ticketMessage.findFirst({
      where: { messageId: email.messageId, isIncoming: true, ticket: { shopId: shop.id } },
      select: { id: true },
    });
    if (existing) return { status: "duplicate" };
  }

  const customer = await findOrCreateCustomerByEmail({
    shopId: shop.id,
    email: email.fromEmail,
    firstName: email.fromName?.split(" ")[0] ?? null,
    lastName: email.fromName?.split(" ").slice(1).join(" ") || null,
  });

  const { ticket, isNew } = await findOrCreateTicketFromEmail({
    shopId: shop.id,
    customerId: customer.id,
    subject: email.subject,
    inReplyTo: email.inReplyTo,
    messageId: email.messageId,
  });

  const message = await db.ticketMessage.create({
    data: {
      ticketId: ticket.id,
      senderType: SenderType.CUSTOMER,
      body: email.bodyText || "(no text body)",
      bodyHtml: email.bodyHtml ?? undefined,
      messageId: email.messageId ?? undefined,
      inReplyTo: email.inReplyTo ?? undefined,
      references: email.references ?? undefined,
      isIncoming: true,
    },
  });

  if (email.attachments?.length) {
    await db.attachment.createMany({
      data: email.attachments.map((attachment) => ({
        ticketId: ticket.id,
        messageId: message.id,
        filename: attachment.filename,
        contentType: attachment.contentType,
        storageKey: attachment.storageKey,
        sizeBytes: attachment.sizeBytes,
      })),
    });
  }

  await db.ticket.update({
    where: { id: ticket.id },
    data: {
      lastMessageAt: new Date(),
      ...(ticket.status === "RESOLVED" || ticket.status === "CLOSED" ? { status: "OPEN", aiStatus: "PENDING", resolvedAt: null } : {}),
    },
  });

  await logAuditEvent({
    shopId: shop.id,
    entityType: "ticket",
    entityId: ticket.id,
    eventType: isNew ? "email.inbound.new_ticket" : "email.inbound.reply",
    details: {
      from: email.fromEmail,
      subject: email.subject,
      messageId: email.messageId,
      ticketNumber: ticket.ticketNumber,
      messageDbId: message.id,
    },
    ticketId: ticket.id,
  });

  console.log(`[email:inbound] ${isNew ? "Created" : "Updated"} ticket ${ticket.ticketNumber} from ${email.fromEmail}`);
  return { status: isNew ? "created" : "reply", ticketNumber: ticket.ticketNumber };
}
