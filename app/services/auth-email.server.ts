import db from "../db.server";
import { sendSystemEmail } from "./email.service.server";

type AuthEmailKind = "login" | "invite";

async function resolveSender(shopId: string) {
  const shop = await db.shop.findUnique({
    where: { id: shopId },
    select: { name: true, supportName: true, supportEmail: true },
  });
  const fromAddress = shop?.supportEmail ?? process.env.EMAIL_FROM_ADDRESS ?? null;
  const displayName =
    shop?.supportName || (shop?.name && !shop.name.endsWith(".myshopify.com") ? shop.name : "Support");
  return { fromAddress, displayName };
}

/** Sends an invitation or sign-in link. Throws if the mail could not be sent. */
export async function sendAuthEmail({
  kind,
  shopId,
  toEmail,
  toName,
  link,
  expiresInText,
}: {
  kind: AuthEmailKind;
  shopId: string;
  toEmail: string;
  toName?: string | null;
  link: string;
  expiresInText: string;
}) {
  const { fromAddress, displayName } = await resolveSender(shopId);
  if (!fromAddress) {
    throw new Error("No sender address: set a support email under Email settings or EMAIL_FROM_ADDRESS.");
  }

  const greeting = toName && toName !== toEmail ? `Hi ${toName},` : "Hi,";
  const subject =
    kind === "invite" ? `You have been invited to ${displayName}'s support team` : `Your sign-in link for ${displayName}`;
  const intro =
    kind === "invite"
      ? `You have been invited to join the ${displayName} support team. Use the link below to accept the invitation and sign in.`
      : `Use the link below to sign in to the ${displayName} support portal.`;

  await sendSystemEmail({
    toEmail,
    subject,
    fromName: displayName,
    fromAddress,
    bodyText: `${greeting}\n\n${intro}\n\n${link}\n\nThis link ${expiresInText} and can only be used once. If you did not expect this email, you can ignore it.\n`,
  });
}
