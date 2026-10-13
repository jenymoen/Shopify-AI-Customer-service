import crypto from "node:crypto";
import db from "../db.server";
import { appConfig } from "../lib/config.server";

const LINK_TTL_SECONDS = 15 * 60;

// <img> and <iframe> requests carry no Shopify session token, so files are opened with a short-lived
// signed link created while rendering an authenticated ticket page.
function sign(attachmentId: string, shopId: string, expires: number) {
  return crypto
    .createHmac("sha256", appConfig.TOKEN_HASH_SECRET)
    .update(`attachment:${attachmentId}:${shopId}:${expires}`)
    .digest("hex");
}

export function signedAttachmentPath(attachmentId: string, shopId: string, options?: { download?: boolean }) {
  const expires = Math.floor(Date.now() / 1000) + LINK_TTL_SECONDS;
  const params = new URLSearchParams({ exp: String(expires), sig: sign(attachmentId, shopId, expires) });
  if (options?.download) params.set("download", "1");
  return `/files/attachments/${attachmentId}?${params.toString()}`;
}

/** Returns the attachment (with its shop) if the link is genuine and not expired, otherwise null. */
export async function findAttachmentForSignedLink(attachmentId: string, expires: string | null, signature: string | null) {
  const exp = Number(expires);
  if (!signature || !Number.isFinite(exp) || exp < Date.now() / 1000) return null;

  const attachment = await db.attachment.findUnique({
    where: { id: attachmentId },
    include: { ticket: { select: { shopId: true } } },
  });
  const shopId = attachment?.ticket?.shopId;
  if (!attachment || !shopId) return null;

  const expected = Buffer.from(sign(attachmentId, shopId, exp), "hex");
  const actual = Buffer.from(signature, "hex");
  if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) return null;
  return attachment;
}

/** Kinds the browser can show safely inline. Everything else is offered as a download only. */
export function previewKind(contentType: string): "image" | "pdf" | "text" | null {
  const type = contentType.toLowerCase().split(";")[0].trim();
  if (["image/png", "image/jpeg", "image/jpg", "image/gif", "image/webp", "image/avif"].includes(type)) return "image";
  if (type === "application/pdf") return "pdf";
  if (type === "text/plain") return "text";
  return null;
}
