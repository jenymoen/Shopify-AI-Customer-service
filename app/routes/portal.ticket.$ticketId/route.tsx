import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";
import { readPortalSessionCookie } from "../../services/portal-auth.server";
import { handleTicketPageAction, loadTicketPage } from "../../services/ticket-page.server";
import type { TicketPagePaths } from "../../services/ticket-page.server";
import { TicketPage } from "../../components/TicketPage";

const PORTAL_PATHS: TicketPagePaths = {
  ticket: (ticketId) => `/portal/ticket/${ticketId}`,
  back: "/portal/dashboard",
  actions: "/portal/actions",
};

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const session = readPortalSessionCookie(request);
  if (!session) return redirect("/portal/login");
  return loadTicketPage(params.ticketId!, session, PORTAL_PATHS);
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const session = readPortalSessionCookie(request);
  if (!session) return redirect("/portal/login");
  return handleTicketPageAction(request, params.ticketId!, session, PORTAL_PATHS);
};

export default TicketPage;
