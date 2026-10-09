import db from "../db.server";
import { lookupShopifyOrdersByEmail } from "./shopify-context.service.server";
import { normalizeShopDomain } from "./shop.service.server";

export interface TimelineEvent {
  id: string;
  type: "TICKET_CREATED" | "TICKET_RESOLVED" | "CUSTOMER_MESSAGE" | "AGENT_REPLY" | "SHOPIFY_ORDER" | "AUDIT_LOG";
  timestamp: Date;
  title: string;
  subtitle?: string;
  details?: string;
  linkUrl?: string;
}

export async function getCustomerTimeline({
  shopId,
  customerId,
  customerEmail,
}: {
  shopId: string;
  customerId?: string | null;
  customerEmail?: string | null;
}): Promise<TimelineEvent[]> {
  const events: TimelineEvent[] = [];

  // Fetch customer's tickets
  const tickets = await db.ticket.findMany({
    where: {
      shopId,
      OR: [
        ...(customerId ? [{ customerId }] : []),
        ...(customerEmail ? [{ customer: { email: customerEmail } }] : []),
      ],
    },
    include: {
      messages: true,
    },
    orderBy: { createdAt: "desc" },
  });

  for (const t of tickets) {
    events.push({
      id: `ticket-${t.id}`,
      type: "TICKET_CREATED",
      timestamp: t.createdAt,
      title: `Ticket ${t.ticketNumber} created`,
      subtitle: t.subject,
      linkUrl: `/portal/ticket/${t.id}`,
    });

    if (t.resolvedAt) {
      events.push({
        id: `ticket-resolved-${t.id}`,
        type: "TICKET_RESOLVED",
        timestamp: t.resolvedAt,
        title: `Ticket ${t.ticketNumber} resolved`,
        subtitle: t.subject,
        linkUrl: `/portal/ticket/${t.id}`,
      });
    }

    for (const m of t.messages) {
      events.push({
        id: `msg-${m.id}`,
        type: m.isIncoming ? "CUSTOMER_MESSAGE" : "AGENT_REPLY",
        timestamp: m.createdAt,
        title: m.isIncoming ? "Customer message" : "Agent response",
        subtitle: `Ticket ${t.ticketNumber}`,
        details: m.body.slice(0, 120),
        linkUrl: `/portal/ticket/${t.id}`,
      });
    }
  }

  // Fetch Shopify Context if customer Email is present
  if (customerEmail) {
    try {
      const shop = await db.shop.findUnique({ where: { id: shopId } });
      if (shop) {
        const orders = await lookupShopifyOrdersByEmail(shopId, customerEmail, shop.domain);
        for (const order of orders) {
          events.push({
            id: `order-${order.id}`,
            type: "SHOPIFY_ORDER",
            timestamp: new Date(order.createdAt),
            title: `Shopify Order ${order.name}`,
            subtitle: `${order.totalPrice} ${order.currency} · Status: ${order.financialStatus}`,
            details: order.lineItems.map((item: { quantity: number; title: string }) => `${item.quantity}x ${item.title}`).join(", "),
          });
        }
      }
    } catch (err) {
      console.warn("[customer-timeline] Shopify context fetch skipped:", err);
    }
  }

  // Sort timeline chronologically descending
  return events.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
}
