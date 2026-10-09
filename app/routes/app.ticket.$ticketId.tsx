import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import db from "../db.server";
import { authenticateAdminOrFallback } from "../shopify.server";
import { ensureShopOwnerMembership, normalizeShopDomain } from "../services/shop.service.server";
import { resolveShopUser } from "../services/authorization.server";
import { handleTicketPageAction, loadTicketPage } from "../services/ticket-page.server";
import type { TicketPagePaths } from "../services/ticket-page.server";
import { TicketPage } from "../components/TicketPage";

const APP_PATHS: TicketPagePaths = {
  ticket: (ticketId) => `/app/ticket/${ticketId}`,
  back: "/app/inbox",
  // The actions queue only exists in the staff portal; stay on the ticket inside the admin.
  actions: "/app/inbox",
};

// Embedded counterpart of /portal/ticket/:id, authenticated by Shopify instead of the portal cookie.
async function requireTicketSession(request: Request) {
  const { session, admin } = await authenticateAdminOrFallback(request);
  const shop = await db.shop.findUnique({ where: { domain: normalizeShopDomain(session.shop) } });
  if (!shop) throw new Response("Shop not found", { status: 404 });

  await ensureShopOwnerMembership(shop.id, admin);

  const email = session.onlineAccessInfo?.associated_user?.email?.trim().toLowerCase();
  const user = await resolveShopUser({ shopId: shop.id, email });
  if (!user) throw new Response("Access denied", { status: 403 });

  return { userId: user.id, shopId: shop.id };
}

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const session = await requireTicketSession(request);
  return loadTicketPage(params.ticketId!, session, APP_PATHS);
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const session = await requireTicketSession(request);
  return handleTicketPageAction(request, params.ticketId!, session, APP_PATHS);
};

export default TicketPage;
