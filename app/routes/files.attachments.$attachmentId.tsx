import type { LoaderFunctionArgs } from "react-router";
import { findAttachmentForSignedLink, previewKind } from "../services/attachment-access.server";

// Resource route: streams one stored attachment. Access is granted by the signed link only.
export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const attachment = await findAttachmentForSignedLink(
    params.attachmentId ?? "",
    url.searchParams.get("exp"),
    url.searchParams.get("sig"),
  );
  if (!attachment) return new Response("This link is invalid or has expired. Reload the ticket.", { status: 403 });

  // storageKey: "resend:<received email id>:<attachment id>"
  const [provider, emailId, providerAttachmentId] = attachment.storageKey.split(":");
  const apiKey = process.env.EMAIL_API_KEY;
  if (provider !== "resend" || !emailId || !providerAttachmentId || !apiKey) {
    return new Response("Attachment storage is not available.", { status: 404 });
  }

  const meta = await fetch(
    `https://api.resend.com/emails/receiving/${encodeURIComponent(emailId)}/attachments/${encodeURIComponent(providerAttachmentId)}`,
    { headers: { Authorization: `Bearer ${apiKey}` } },
  );
  if (!meta.ok) {
    console.error(`[attachments] Resend lookup failed for ${attachment.id}: HTTP ${meta.status}`);
    return new Response("The file is no longer available from the email provider.", { status: 502 });
  }
  const { download_url: downloadUrl } = (await meta.json()) as { download_url?: string };
  if (!downloadUrl) return new Response("The file is no longer available.", { status: 502 });

  const file = await fetch(downloadUrl);
  if (!file.ok || !file.body) return new Response("Could not fetch the file.", { status: 502 });

  const kind = previewKind(attachment.contentType);
  const inline = kind !== null && url.searchParams.get("download") !== "1";
  const asciiName = attachment.filename.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");

  return new Response(file.body, {
    headers: {
      "Content-Type": kind ? attachment.contentType : "application/octet-stream",
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(attachment.filename)}`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, max-age=300",
    },
  });
};
