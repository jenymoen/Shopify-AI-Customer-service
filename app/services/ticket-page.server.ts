import { data, redirect } from "react-router";
import { AIExecutionDecision, PermissionName, SenderType, TicketStatus } from "@prisma/client";
import db from "../db.server";
import { hasPermission } from "./authorization.server";
import {
  createInternalNote,
  createTicketMessage,
  toggleTicketFollower,
  updateTicketAssignmentAndStatus,
} from "./ticket.service.server";
import { getActiveAiInstructionsForShop, searchKnowledgeForTicket } from "./knowledge.service.server";
import { lookupShopifyCustomerByEmail, lookupShopifyOrdersByEmail } from "./shopify-context.service.server";
import { runOrchestratorForTicket } from "./ai.orchestrator.server";
import { logAuditEvent } from "./audit.service.server";
import { sendReplyToCustomer } from "./email.service.server";
import { getActionRegistry, proposeAction } from "./actions.service.server";

/** Who is acting on the ticket. Resolved by the caller (portal cookie or Shopify admin auth). */
export type TicketPageSession = { userId: string; shopId: string };

/** Where the ticket page links and redirects to, so it can live under /portal or /app. */
export type TicketPagePaths = {
  ticket: (ticketId: string) => string;
  back: string;
  actions: string;
};

function buildAiSuggestion(
  ticket: {
    subject: string;
    customer?: { firstName?: string | null; lastName?: string | null; email?: string | null } | null;
    messages: Array<{ body: string; senderType: string; isIncoming: boolean }>;
  },
  context?: {
    activeInstructions?: Array<{ name: string; type: string; content: string }>;
    knowledgeMatches?: Array<{ title: string; content: string; sourceType: string; sourceUrl?: string | null }>;
  },
) {
  const recentCustomerMessage = [...ticket.messages]
    .reverse()
    .find((message) => message.isIncoming || message.senderType === "CUSTOMER");

  const customerName =
    ticket.customer?.firstName || ticket.customer?.lastName
      ? [ticket.customer?.firstName, ticket.customer?.lastName].filter(Boolean).join(" ")
      : ticket.customer?.email ?? "there";

  const issueSummary = recentCustomerMessage?.body?.trim() || "Thanks for contacting us.";
  const instructionSummary = context?.activeInstructions?.length
    ? `Policy notes considered: ${context.activeInstructions.map((instruction) => instruction.name).join(", ")}.`
    : "No special policy notes were active.";
  const knowledgeSummary = context?.knowledgeMatches?.length
    ? `Relevant knowledge: ${context.knowledgeMatches.map((match) => match.title).join(", ")}.`
    : "No knowledge article matched this ticket.";

  return [
    `Hi ${customerName},`,
    "",
    `Thanks for reaching out about “${ticket.subject}”. I’ve reviewed your message and I’m happy to help with this.`,
    "",
    `Based on the latest update, it sounds like: ${issueSummary.slice(0, 220)}`,
    "",
    instructionSummary,
    knowledgeSummary,
    "",
    "I’ll keep this moving on my side and will update you as soon as I have the next step or a clear resolution.",
    "",
    "Thanks for your patience,",
    "Support team",
  ].join("\n");
}

export async function loadTicketPage(ticketId: string, session: TicketPageSession, paths: TicketPagePaths) {
  const membership = await db.shopMembership.findUnique({
    where: {
      shopId_userId: {
        shopId: session.shopId,
        userId: session.userId,
      },
    },
  });

  if (!membership) {
    throw new Response("Unauthorized", { status: 401 });
  }

  const canManageInternalNotes = await hasPermission({
    userId: session.userId,
    shopId: session.shopId,
    permission: PermissionName.TICKETS_INTERNAL_NOTE,
  });

  const ticket = await db.ticket.findFirst({
    where: {
      id: ticketId,
      shopId: session.shopId,
    },
    include: {
      customer: true,
      messages: {
        orderBy: { createdAt: "asc" },
      },
      internalNotes: {
        orderBy: { createdAt: "asc" },
        include: {
          author: {
            select: {
              id: true,
              email: true,
              name: true,
            },
          },
        },
      },
      assignee: {
        select: {
          id: true,
          email: true,
          name: true,
        },
      },
      assignmentHistory: {
        orderBy: { createdAt: "desc" },
        include: {
          actorUser: {
            select: {
              id: true,
              email: true,
              name: true,
            },
          },
        },
      },
      followers: {
        include: {
          user: {
            select: {
              id: true,
              email: true,
              name: true,
            },
          },
        },
        orderBy: {
          user: {
            email: "asc",
          },
        },
      },
    },
  });

  if (!ticket) {
    throw new Response("Ticket not found", { status: 404 });
  }

  const shop = await db.shop.findUnique({
    where: { id: session.shopId },
    select: { domain: true },
  });

  const customerEmail = ticket.customer?.email ?? null;

  const [agents, latestAiExecution, activeInstructions, knowledgeMatches, shopifyCustomer, shopifyOrders] = await Promise.all([
    db.shopMembership.findMany({
      where: { shopId: session.shopId },
      include: {
        user: true,
        role: true,
      },
      orderBy: [{ user: { email: "asc" } }],
    }),
    db.aIExecution.findFirst({
      where: { ticketId: ticketId, shopId: session.shopId },
      orderBy: { createdAt: "desc" },
    }),
    getActiveAiInstructionsForShop(session.shopId),
    searchKnowledgeForTicket({
      shopId: session.shopId,
      query: [ticket.subject, ...ticket.messages.map((message) => message.body)].join(" "),
      limit: 3,
    }),
    customerEmail && shop?.domain
      ? lookupShopifyCustomerByEmail(session.shopId, customerEmail, shop.domain)
      : Promise.resolve(null),
    customerEmail && shop?.domain
      ? lookupShopifyOrdersByEmail(session.shopId, customerEmail, shop.domain, 5)
      : Promise.resolve([]),
  ]);

  const aiSuggestion =
    typeof latestAiExecution?.result === "object" && latestAiExecution.result !== null && "suggestedReply" in latestAiExecution.result
      ? String((latestAiExecution.result as { suggestedReply?: string }).suggestedReply ?? "")
      : "";

  const isFollowing = ticket.followers.some((follower) => follower.userId === session.userId);

  return {
    backPath: paths.back,
    actionsPath: paths.actions,
    id: ticket.id,
    ticketNumber: ticket.ticketNumber,
    subject: ticket.subject,
    status: ticket.status,
    priority: ticket.priority,
    customerEmail: ticket.customer?.email ?? "No customer",
    assignee: ticket.assignee,
    source: ticket.source,
    createdAt: ticket.createdAt.toISOString(),
    canManageInternalNotes,
    isFollowing,
    actionTypes: getActionRegistry(),
    followers: ticket.followers.map((follower: { user: { id: string; name?: string | null; email: string } }) => ({
      id: follower.user.id,
      name: follower.user.name ?? follower.user.email,
      email: follower.user.email,
    })),
    assignmentHistory: ticket.assignmentHistory.map((entry: { id: string; createdAt: Date; reason?: string | null; actorUser?: { name?: string | null; email?: string | null } | null }) => ({
      id: entry.id,
      createdAt: entry.createdAt.toISOString(),
      reason: entry.reason,
      actorName: entry.actorUser?.name ?? entry.actorUser?.email ?? "System",
    })),
    aiSuggestion,
    activeInstructions: activeInstructions.map((instruction: { id: string; name: string; type: string; content: string }) => ({
      id: instruction.id,
      name: instruction.name,
      type: instruction.type,
      content: instruction.content,
    })),
    knowledgeMatches: knowledgeMatches.map((match: { id: string; title: string; content: string; sourceType: string; sourceUrl?: string | null; score: number }) => ({
      id: match.id,
      title: match.title,
      content: match.content,
      sourceType: match.sourceType,
      sourceUrl: match.sourceUrl,
      score: match.score,
    })),
    agents: agents.map((agent: { user: { id: string; name: string | null; email: string }; role: { name: string } }) => ({
      id: agent.user.id,
      name: agent.user.name ?? agent.user.email,
      email: agent.user.email,
      roleName: agent.role.name,
    })),
    shopifyCustomer: shopifyCustomer
      ? {
          id: shopifyCustomer.id,
          firstName: shopifyCustomer.firstName,
          lastName: shopifyCustomer.lastName,
          email: shopifyCustomer.email,
          phone: shopifyCustomer.phone,
          ordersCount: shopifyCustomer.ordersCount,
          totalSpent: shopifyCustomer.totalSpent,
          tags: shopifyCustomer.tags,
          state: shopifyCustomer.state,
          verifiedEmail: shopifyCustomer.verifiedEmail,
        }
      : null,
    shopifyOrders: shopifyOrders.map((order) => ({
      id: order.id,
      name: order.name,
      createdAt: order.createdAt,
      financialStatus: order.financialStatus,
      fulfillmentStatus: order.fulfillmentStatus,
      totalPrice: order.totalPrice,
      currency: order.currency,
      lineItems: order.lineItems,
      trackingUrls: order.trackingUrls,
      cancelledAt: order.cancelledAt,
      refunds: order.refunds,
    })),
    messages: ticket.messages.map((message: { id: string; body: string; senderType: string; isIncoming: boolean; createdAt: Date }) => ({
      id: message.id,
      body: message.body,
      senderType: message.senderType,
      isIncoming: message.isIncoming,
      createdAt: message.createdAt.toISOString(),
    })),
    internalNotes: ticket.internalNotes.map((note: { id: string; body: string; createdAt: Date; author?: { name?: string | null; email?: string | null } | null; isVisibleToCustomer: boolean }) => ({
      id: note.id,
      body: note.body,
      createdAt: note.createdAt.toISOString(),
      authorName: note.author?.name ?? note.author?.email ?? "Staff",
      isVisibleToCustomer: note.isVisibleToCustomer,
    })),
  };
}

export type TicketPageData = Awaited<ReturnType<typeof loadTicketPage>>;

export type TicketActionError = { sendError: string };

export type TicketUpdateKind = "reply" | "note" | "status" | "priority" | "assignee";

// The ticket page reads `?updated=` to confirm what the last save changed ("none" = nothing did).
function ticketPathWithUpdates(path: string, updates: TicketUpdateKind[]) {
  return `${path}?updated=${updates.length ? updates.join(",") : "none"}`;
}

export async function handleTicketPageAction(
  request: Request,
  ticketId: string,
  session: TicketPageSession,
  paths: TicketPagePaths,
) {
  const formData = await request.formData();
  const intent = String(formData.get("intent") ?? "").trim();
  const message = String(formData.get("message") ?? "").trim();
  const internalNote = String(formData.get("internalNote") ?? "").trim();
  const statusValue = String(formData.get("status") ?? "").trim();
  const assigneeId = String(formData.get("assigneeId") ?? "").trim();
  const priorityValue = String(formData.get("priority") ?? "").trim();

  const ticket = await db.ticket.findFirst({
    where: {
      id: ticketId,
      shopId: session.shopId,
    },
    include: {
      customer: true,
      messages: {
        orderBy: { createdAt: "asc" },
      },
    },
  });

  if (!ticket) {
    throw new Response("Ticket not found", { status: 404 });
  }

  if (intent === "generate-ai") {
    await runOrchestratorForTicket(ticket.id, session.shopId);
    return redirect(paths.ticket(ticket.id));
  }

  if (intent === "follow" || intent === "unfollow") {
    await toggleTicketFollower({
      ticketId: ticket.id,
      shopId: session.shopId,
      userId: session.userId,
    });

    return redirect(paths.ticket(ticket.id));
  }

  if (intent === "propose-action") {
    const actionType = String(formData.get("actionType") ?? "").trim();
    const rawInput = String(formData.get("actionInput") ?? "").trim();
    const shop = await db.shop.findUnique({ where: { id: session.shopId }, select: { domain: true } });
    if (!shop) throw new Response("Shop not found", { status: 404 });

    let parsedInput: unknown;
    try {
      parsedInput = rawInput ? JSON.parse(rawInput) : {};
    } catch {
      throw new Response("Action input must be valid JSON", { status: 400 });
    }

    await proposeAction({
      shopId: session.shopId,
      shopDomain: shop.domain,
      actionType,
      input: parsedInput,
      ticketId: ticket.id,
      requestedByUserId: session.userId,
    });

    return redirect(paths.actions);
  }

  const updates: TicketUpdateKind[] = [];
  const finalMessage = intent === "approve-ai" ? String(formData.get("aiSuggestion") ?? "").trim() || message : message;

  if (finalMessage) {
    const user = await db.user.findUnique({ where: { id: session.userId } });

    // Deliver first: a reply that failed to send must not show up as sent on the ticket.
    let outbound: { messageId: string; inReplyTo: string | null; references: string | null } | null = null;
    const customerEmail = ticket.customer?.email?.trim().toLowerCase();
    if (customerEmail) {
      const shop = await db.shop.findUnique({ where: { id: session.shopId }, select: { name: true, supportEmail: true } });
      const fromAddress = shop?.supportEmail ?? process.env.EMAIL_FROM_ADDRESS ?? null;
      if (!fromAddress && process.env.EMAIL_API_KEY) {
        return data<TicketActionError>(
          { sendError: "No sender address is set. Add a support email under Email settings." },
          { status: 400 },
        );
      }

      const lastIncoming = [...ticket.messages].reverse().find((m) => m.isIncoming && m.messageId);
      const inReplyTo = lastIncoming?.messageId ?? null;
      const references = [lastIncoming?.references, inReplyTo].filter(Boolean).join(" ") || null;
      const subject = `${/^re:/i.test(ticket.subject) ? ticket.subject : `Re: ${ticket.subject}`} [${ticket.ticketNumber}]`;

      try {
        const { messageId } = await sendReplyToCustomer({
          shopId: session.shopId,
          ticketId: ticket.id,
          ticketNumber: ticket.ticketNumber,
          toEmail: customerEmail,
          toName: [ticket.customer?.firstName, ticket.customer?.lastName].filter(Boolean).join(" ") || null,
          fromName: shop?.name ?? "Support",
          fromAddress: fromAddress ?? "support@localhost",
          subject,
          bodyText: finalMessage,
          inReplyTo,
          references,
          actorUserId: session.userId,
        });
        outbound = { messageId, inReplyTo, references };
      } catch (error) {
        console.error("[email:outbound] send failed", error);
        return data<TicketActionError>(
          { sendError: `The reply could not be sent: ${error instanceof Error ? error.message.slice(0, 200) : "unknown error"}` },
          { status: 502 },
        );
      }
    }

    await createTicketMessage({
      ticketId: ticket.id,
      body: finalMessage,
      senderUserId: user?.id ?? null,
      senderType: SenderType.AGENT,
      isIncoming: false,
      messageId: outbound?.messageId,
      inReplyTo: outbound?.inReplyTo,
      references: outbound?.references,
    });

    await logAuditEvent({
      shopId: session.shopId,
      actorUserId: session.userId,
      entityType: "ticket",
      entityId: ticket.id,
      eventType: intent === "approve-ai" ? "ticket.message.ai_approved" : "ticket.message.sent",
      details: { bodyLength: finalMessage.length },
      ticketId: ticket.id,
    });
    updates.push("reply");
  }

  if (internalNote) {
    const canManageInternalNotes = await hasPermission({
      userId: session.userId,
      shopId: session.shopId,
      permission: PermissionName.TICKETS_INTERNAL_NOTE,
    });

    if (!canManageInternalNotes) {
      throw new Response("Forbidden", { status: 403 });
    }

    await createInternalNote({
      ticketId: ticket.id,
      authorUserId: session.userId,
      body: internalNote,
    });

    await logAuditEvent({
      shopId: session.shopId,
      actorUserId: session.userId,
      entityType: "ticket",
      entityId: ticket.id,
      eventType: "ticket.note.created",
      details: { bodyLength: internalNote.length },
      ticketId: ticket.id,
    });
    updates.push("note");
  }

  if (statusValue || priorityValue) {
    const allowedStatuses = Object.values(TicketStatus);
    const parsedStatus = statusValue && allowedStatuses.includes(statusValue as TicketStatus)
      ? (statusValue as TicketStatus)
      : undefined;

    const allowedPriorities = ["LOW", "NORMAL", "HIGH", "URGENT"];
    const parsedPriority = priorityValue && allowedPriorities.includes(priorityValue.toUpperCase())
      ? priorityValue.toUpperCase()
      : undefined;

    if (statusValue && !parsedStatus) {
      throw new Response("Invalid status", { status: 400 });
    }

    if (priorityValue && !parsedPriority) {
      throw new Response("Invalid priority", { status: 400 });
    }

    const assigneeCandidate = assigneeId || null;

    if (assigneeCandidate) {
      const validAssignee = await db.shopMembership.findUnique({
        where: {
          shopId_userId: {
            shopId: session.shopId,
            userId: assigneeCandidate,
          },
        },
      });

      if (!validAssignee) {
        throw new Response("Assignee not found in this shop", { status: 400 });
      }
    }

    if (parsedStatus && parsedStatus !== ticket.status) updates.push("status");
    if (parsedPriority && parsedPriority !== ticket.priority) updates.push("priority");
    if (assigneeCandidate !== (ticket.assigneeId ?? null)) updates.push("assignee");

    await updateTicketAssignmentAndStatus({
      ticketId: ticket.id,
      shopId: session.shopId,
      status: parsedStatus,
      assigneeId: assigneeCandidate,
      priority: parsedPriority,
      actorUserId: session.userId,
    });

    await logAuditEvent({
      shopId: session.shopId,
      actorUserId: session.userId,
      entityType: "ticket",
      entityId: ticket.id,
      eventType: "ticket.updated",
      details: {
        status: parsedStatus,
        assigneeId: assigneeCandidate,
        priority: parsedPriority,
      },
      ticketId: ticket.id,
    });
  }

  return redirect(ticketPathWithUpdates(paths.ticket(ticket.id), updates));
}
