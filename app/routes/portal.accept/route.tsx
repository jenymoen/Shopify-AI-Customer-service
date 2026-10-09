import type { LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { acceptMagicLinkToken, createPortalSessionCookie } from "../../services/portal-auth.server";
import { logAuditEvent } from "../../services/audit.service.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const email = url.searchParams.get("email") ?? "";
  const token = url.searchParams.get("token") ?? "";
  const shopId = url.searchParams.get("shopId") ?? undefined;

  if (!email || !token) {
    throw new Response("Missing email or token.", { status: 400 });
  }

  const result = await acceptMagicLinkToken({
    email,
    token,
    shopId,
  });

  if (!result) {
    throw new Response("This magic link is invalid or has expired.", { status: 401 });
  }

  const cookie = createPortalSessionCookie({
    email: result.user.email,
    shopId: result.shopId,
    userId: result.user.id,
  });

  await logAuditEvent({
    shopId: result.shopId,
    actorUserId: result.user.id,
    entityType: "user",
    entityId: result.user.id,
    eventType: "auth.login.magic_link",
    details: { email: result.user.email, role: result.roleName },
  });

  const response = new Response(null, {
    status: 302,
    headers: {
      Location: "/portal/dashboard",
      "Set-Cookie": cookie,
    },
  });

  throw response;
};

export default function PortalAcceptPage() {
  return <s-page heading="Accepting portal access" />;
}
