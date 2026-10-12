import type { ActionFunctionArgs } from "react-router";
import crypto from "node:crypto";
import { processInboundEmail } from "../../services/email-inbound.server";

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

  await processInboundEmail({
    fromEmail,
    fromName,
    toEmails,
    ccEmails,
    mailboxHash: String(payload["MailboxHash"] ?? "").trim(),
    subject,
    bodyText,
    bodyHtml,
    messageId,
    inReplyTo,
    references,
  });

  // Always 200 once handled: an unresolved shop or a duplicate will not get better on retry.
  return new Response("OK", { status: 200 });
};
