import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import db from "../db.server";
import { findOrCreateCustomerByEmail, findOrCreateTicketFromEmail } from "../services/ticket.service.server";
import { searchKnowledgeForTicket } from "../services/knowledge.service.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  return new Response(JSON.stringify({ status: "ok", service: "Storefront Support API" }), {
    headers: { "Content-Type": "application/json" },
  });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  try {
    const body = await request.json();
    const { intent, shopDomain, email, subject, message, orderNumber } = body;

    if (!shopDomain || !email || !subject) {
      return new Response(JSON.stringify({ error: "Missing required fields: shopDomain, email, subject" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const shop = await db.shop.findFirst({
      where: { domain: shopDomain },
    });

    if (!shop) {
      return new Response(JSON.stringify({ error: "Shop not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Step 1: Self-Service AI Check Intent
    if (intent === "self_service_check") {
      const chunks = await searchKnowledgeForTicket({
        shopId: shop.id,
        query: `${subject} ${message || ""}`,
        limit: 2,
      });

      if (chunks.length > 0) {
        return new Response(
          JSON.stringify({
            resolvedBySelfService: false,
            suggestedSolution: chunks[0].content,
            sourceTitle: chunks[0].title,
          }),
          { headers: { "Content-Type": "application/json" } }
        );
      }

      return new Response(
        JSON.stringify({
          resolvedBySelfService: false,
          suggestedSolution: null,
        }),
        { headers: { "Content-Type": "application/json" } }
      );
    }

    // Step 2: Create Support Ticket
    const customer = await findOrCreateCustomerByEmail({
      shopId: shop.id,
      email,
    });

    const fullSubject = orderNumber ? `[Order #${orderNumber}] ${subject}` : subject;

    const { ticket } = await findOrCreateTicketFromEmail({
      shopId: shop.id,
      customerId: customer.id,
      subject: fullSubject,
      body: message || subject,
      source: "STOREFRONT",
    });

    return new Response(
      JSON.stringify({
        success: true,
        ticketNumber: ticket.ticketNumber,
        ticketId: ticket.id,
        message: "Support ticket created successfully. We will follow up via email shortly.",
      }),
      { headers: { "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    console.error("[storefront-support-api] Error:", err);
    return new Response(JSON.stringify({ error: err.message || "Internal server error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
};
