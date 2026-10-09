import { appConfig } from "../lib/config.server";
import { logAuditEvent } from "./audit.service.server";

export interface SendReplyOptions {
  shopId: string;
  ticketId: string;
  ticketNumber: string;
  toEmail: string;
  toName?: string | null;
  fromName: string;
  /** Verified sender address, e.g. the shop's support email. */
  fromAddress: string;
  subject: string;
  bodyText: string;
  bodyHtml?: string | null;
  inReplyTo?: string | null;
  references?: string | null;
  actorUserId?: string | null;
}

export async function sendReplyToCustomer(options: SendReplyOptions): Promise<{ messageId: string }> {
  const fromDomain = options.fromAddress.split("@")[1] ?? "localhost";
  const messageId = `<reply-${options.ticketId}-${Date.now()}@${fromDomain}>`;

  if (appConfig.EMAIL_PROVIDER === "postmark" && appConfig.EMAIL_API_KEY) {
    await sendViaPostmark(options, messageId);
  } else if (appConfig.EMAIL_PROVIDER === "resend" && appConfig.EMAIL_API_KEY) {
    await sendViaResend(options, messageId);
  } else {
    // Dev/stub mode: log to console
    console.log("[email:stub] Would send email:", {
      to: options.toEmail,
      from: `${options.fromName} <${options.fromAddress}>`,
      subject: options.subject,
      bodyText: options.bodyText.slice(0, 120),
      messageId,
    });
  }

  await logAuditEvent({
    shopId: options.shopId,
    actorUserId: options.actorUserId ?? null,
    entityType: "ticket",
    entityId: options.ticketId,
    eventType: "email.outbound.sent",
    details: {
      to: options.toEmail,
      subject: options.subject,
      messageId,
      provider: appConfig.EMAIL_PROVIDER,
    },
    ticketId: options.ticketId,
  });

  return { messageId };
}

async function sendViaPostmark(options: SendReplyOptions, messageId: string): Promise<void> {
  const headers: Record<string, string> = {
    Accept: "application/json",
    "Content-Type": "application/json",
    "X-Postmark-Server-Token": appConfig.EMAIL_API_KEY!,
  };

  const body: Record<string, unknown> = {
    From: `${options.fromName} <${options.fromAddress}>`,
    To: options.toEmail,
    Subject: options.subject,
    TextBody: options.bodyText,
    ...(options.bodyHtml ? { HtmlBody: options.bodyHtml } : {}),
    Headers: [
      { Name: "Message-ID", Value: messageId },
      ...(options.inReplyTo ? [{ Name: "In-Reply-To", Value: options.inReplyTo }] : []),
      ...(options.references ? [{ Name: "References", Value: options.references }] : []),
    ],
    MessageStream: "outbound",
  };

  const res = await fetch("https://api.postmarkapp.com/email", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Postmark send failed: ${res.status} ${text}`);
  }
}

async function sendViaResend(options: SendReplyOptions, messageId: string): Promise<void> {
  const body: Record<string, unknown> = {
    from: `${options.fromName} <${options.fromAddress}>`,
    to: [options.toEmail],
    subject: options.subject,
    text: options.bodyText,
    ...(options.bodyHtml ? { html: options.bodyHtml } : {}),
    headers: {
      "Message-ID": messageId,
      ...(options.inReplyTo ? { "In-Reply-To": options.inReplyTo } : {}),
      ...(options.references ? { References: options.references } : {}),
    },
  };

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${appConfig.EMAIL_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Resend send failed: ${res.status} ${text}`);
  }
}
