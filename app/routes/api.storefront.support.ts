import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import db from "../db.server";
import { findOrCreateCustomerByEmail, findOrCreateTicketFromEmail } from "../services/ticket.service.server";
import { searchKnowledgeForTicket } from "../services/knowledge.service.server";

// Called from the merchant's storefront (any origin, incl. custom domains), so CORS is open.
// The endpoint is unauthenticated and cookie-less; abuse is limited by validation + honeypot.
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });

export const loader = async ({ request }: LoaderFunctionArgs) => {
  return json({ status: "ok", service: "Storefront Support API" });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  try {
    const body = await request.json();
    const { intent, shopDomain, email, name, subject, message, orderNumber, website } = body;

    // Honeypot: real users never fill this hidden field. Pretend success to bots.
    if (website) {
      return json({ success: true });
    }

    if (!shopDomain || !email || !subject) {
      return json({ error: "Missing required fields: shopDomain, email, subject" }, 400);
    }

    if (
      typeof email !== "string" ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
      email.length > 254 ||
      String(subject).length > 200 ||
      String(message || "").length > 10000
    ) {
      return json({ error: "Invalid input" }, 400);
    }

    const shop = await db.shop.findFirst({
      where: { domain: shopDomain },
    });

    if (!shop) {
      return json({ error: "Shop not found" }, 404);
    }

    // Step 1: Self-Service AI Check Intent
    if (intent === "self_service_check") {
      const chunks = await searchKnowledgeForTicket({
        shopId: shop.id,
        query: `${subject} ${message || ""}`,
        limit: 2,
      });

      if (chunks.length > 0) {
        return json({
          resolvedBySelfService: false,
          suggestedSolution: chunks[0].content,
          sourceTitle: chunks[0].title,
        });
      }

      return json({ resolvedBySelfService: false, suggestedSolution: null });
    }

    // Step 2: Create Support Ticket
    const [firstName, ...rest] = String(name || "").trim().split(/\s+/);
    const customer = await findOrCreateCustomerByEmail({
      shopId: shop.id,
      email,
      firstName: firstName || null,
      lastName: rest.join(" ") || null,
    });

    const fullSubject = orderNumber ? `[Order #${orderNumber}] ${subject}` : subject;

    const { ticket } = await findOrCreateTicketFromEmail({
      shopId: shop.id,
      customerId: customer.id,
      subject: fullSubject,
      body: message || subject,
      source: "STOREFRONT",
    });

    return json({
      success: true,
      ticketNumber: ticket.ticketNumber,
      message: "Support ticket created successfully. We will follow up via email shortly.",
    });
  } catch (err: any) {
    console.error("[storefront-support-api] Error:", err);
    return json({ error: "Internal server error" }, 500);
  }
};
