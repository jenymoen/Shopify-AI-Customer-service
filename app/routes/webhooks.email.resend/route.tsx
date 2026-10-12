import type { ActionFunctionArgs } from "react-router";
import crypto from "node:crypto";
import { processInboundEmail } from "../../services/email-inbound.server";

// Resend signs webhooks with Svix: HMAC-SHA256 over `${svix-id}.${svix-timestamp}.${rawBody}`,
// keyed with the base64 part of the `whsec_...` secret.
const TIMESTAMP_TOLERANCE_SECONDS = 5 * 60;

function verifySvixSignature(rawBody: string, headers: Headers, secret: string): boolean {
  const id = headers.get("svix-id");
  const timestamp = headers.get("svix-timestamp");
  const signatureHeader = headers.get("svix-signature");
  if (!id || !timestamp || !signatureHeader) return false;

  const ageSeconds = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (!Number.isFinite(ageSeconds) || ageSeconds > TIMESTAMP_TOLERANCE_SECONDS) return false;

  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  const expected = crypto.createHmac("sha256", key).update(`${id}.${timestamp}.${rawBody}`).digest();

  // The header holds one or more space separated "v1,<base64>" entries (several during key rotation).
  return signatureHeader.split(" ").some((entry) => {
    const [version, signature] = entry.split(",");
    if (version !== "v1" || !signature) return false;
    const actual = Buffer.from(signature, "base64");
    return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
  });
}

// "Jens Nymoen <jens@example.com>" or "jens@example.com" -> { email, name }
function parseAddress(value: unknown): { email: string; name: string | null } {
  const text = String(value ?? "").trim();
  const match = text.match(/^(.*?)<([^>]+)>\s*$/);
  if (match) {
    const name = match[1].trim().replace(/^"|"$/g, "");
    return { email: match[2].trim().toLowerCase(), name: name || null };
  }
  return { email: text.toLowerCase(), name: null };
}

function addressList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => parseAddress(item).email).filter(Boolean);
}

function htmlToText(html: string): string {
  return html
    .replace(/<(style|script)[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>|<\/(p|div|tr|li|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });

  const secret = process.env.RESEND_WEBHOOK_SECRET;
  const apiKey = process.env.EMAIL_API_KEY;
  if (!secret || !apiKey) {
    console.error("[email:resend] RESEND_WEBHOOK_SECRET and EMAIL_API_KEY must both be set");
    return new Response("Not configured", { status: 500 });
  }

  const rawBody = await request.text();
  if (!verifySvixSignature(rawBody, request.headers, secret)) {
    return new Response("Unauthorized", { status: 401 });
  }

  let event: { type?: string; data?: Record<string, unknown> };
  try {
    event = JSON.parse(rawBody);
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  // Resend uses the same endpoint for every event type; only received mail is relevant here.
  if (event.type !== "email.received" || !event.data) return new Response("Ignored", { status: 200 });

  const data = event.data;
  const emailId = String(data["email_id"] ?? "");
  if (!emailId) return new Response("Missing email_id", { status: 400 });

  // The webhook carries metadata only; body and headers have to be fetched.
  const res = await fetch(`https://api.resend.com/emails/receiving/${encodeURIComponent(emailId)}?html_format=cid`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok) {
    console.error(`[email:resend] Could not fetch received email ${emailId}: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
    // A non-2xx makes Resend retry the delivery.
    return new Response("Could not fetch email", { status: 502 });
  }
  const email = (await res.json()) as Record<string, unknown>;

  const headers: Record<string, string> = {};
  const rawHeaders = email["headers"];
  if (rawHeaders && typeof rawHeaders === "object" && !Array.isArray(rawHeaders)) {
    for (const [name, value] of Object.entries(rawHeaders as Record<string, unknown>)) {
      headers[name.toLowerCase()] = String(value);
    }
  }

  const from = parseAddress(email["from"] ?? data["from"]);
  if (!from.email) return new Response("Missing sender email", { status: 400 });

  const bodyHtml = email["html"] ? String(email["html"]).trim() : null;
  const bodyText = (email["text"] ? String(email["text"]).trim() : "") || (bodyHtml ? htmlToText(bodyHtml) : "");
  if (!bodyText && !bodyHtml) return new Response("Missing email body", { status: 400 });

  // A mail forwarded from the shop's own address keeps it in To/Cc; received_for is the address
  // Resend actually delivered to (the inbound subdomain), which carries an optional +tag.
  const receivedFor = addressList(email["received_for"] ?? data["received_for"]);
  const toEmails = [
    ...addressList(email["to"] ?? data["to"]),
    ...receivedFor,
    ...["delivered-to", "x-original-to", "x-forwarded-to"].flatMap((name) => (headers[name] ? [parseAddress(headers[name]).email] : [])),
  ];
  const mailboxHash = receivedFor.map((address) => address.split("@")[0].split("+")[1]).find(Boolean) ?? null;

  const result = await processInboundEmail({
    fromEmail: from.email,
    fromName: from.name,
    toEmails: [...new Set(toEmails)],
    ccEmails: addressList(email["cc"] ?? data["cc"]),
    mailboxHash,
    subject: String(email["subject"] ?? data["subject"] ?? "No subject").trim(),
    bodyText,
    bodyHtml,
    messageId: String(email["message_id"] ?? data["message_id"] ?? headers["message-id"] ?? "").trim() || null,
    inReplyTo: headers["in-reply-to"]?.trim() || null,
    references: headers["references"]?.trim() || null,
  });

  // Always 200 once handled: an unresolved shop or a duplicate will not get better on retry.
  return new Response(result.status, { status: 200 });
};
