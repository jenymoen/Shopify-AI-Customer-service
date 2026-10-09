import db from "../db.server";
import { findOrCreateCustomerByEmail, findOrCreateTicketFromEmail } from "./ticket.service.server";
import { logAuditEvent } from "./audit.service.server";

export interface ProactiveSuggestion {
  customerEmail: string;
  orderName: string;
  delayReason: string;
  suggestedSubject: string;
  suggestedBody: string;
}

export async function generateProactiveSupportDrafts({
  shopId,
  delayedOrders,
  actorUserId,
}: {
  shopId: string;
  delayedOrders: Array<{ customerEmail: string; orderName: string; daysDelayed: number }>;
  actorUserId: string;
}): Promise<ProactiveSuggestion[]> {
  const suggestions: ProactiveSuggestion[] = [];

  for (const item of delayedOrders) {
    const suggestion: ProactiveSuggestion = {
      customerEmail: item.customerEmail,
      orderName: item.orderName,
      delayReason: `Fulfillment delayed by ${item.daysDelayed} days`,
      suggestedSubject: `Update regarding your Shopify order ${item.orderName}`,
      suggestedBody: `Hi! We noticed your order ${item.orderName} is experiencing a slight delay in processing. Our team is actively tracking it and will notify you as soon as it ships! Thank you for your patience.`,
    };
    suggestions.push(suggestion);
  }

  await logAuditEvent({
    shopId,
    actorUserId,
    entityType: "proactive_support",
    entityId: shopId,
    eventType: "proactive.drafts_generated",
    details: { count: suggestions.length },
  });

  return suggestions;
}

export async function approveAndSendProactiveDraft({
  shopId,
  customerEmail,
  subject,
  body,
  actorUserId,
}: {
  shopId: string;
  customerEmail: string;
  subject: string;
  body: string;
  actorUserId: string;
}) {
  const customer = await findOrCreateCustomerByEmail({
    shopId,
    email: customerEmail,
  });

  const { ticket } = await findOrCreateTicketFromEmail({
    shopId,
    customerId: customer.id,
    subject: `[Proactive Support] ${subject}`,
    body,
  });

  await logAuditEvent({
    shopId,
    actorUserId,
    entityType: "ticket",
    entityId: ticket.id,
    eventType: "proactive.ticket_sent",
    details: { customerEmail, ticketId: ticket.id },
    ticketId: ticket.id,
  });

  return ticket;
}
