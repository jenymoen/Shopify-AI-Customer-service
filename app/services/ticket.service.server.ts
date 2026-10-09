import { SenderType, TicketSource, TicketStatus } from "@prisma/client";
import db from "../db.server";

export async function findOrCreateCustomerByEmail({
  shopId,
  email,
  firstName,
  lastName,
}: {
  shopId: string;
  email: string;
  firstName?: string | null;
  lastName?: string | null;
}) {
  const normalizedEmail = email.trim().toLowerCase();

  const existing = await db.customer.findFirst({
    where: { shopId, email: normalizedEmail },
  });

  if (existing) {
    return existing;
  }

  return db.customer.create({
    data: {
      shopId,
      email: normalizedEmail,
      firstName: firstName ?? normalizedEmail.split("@")[0],
      lastName: lastName ?? null,
    },
  });
}

export async function findOrCreateTicketFromEmail({
  shopId,
  customerId,
  subject,
  inReplyTo,
  messageId,
  body,
  source = TicketSource.EMAIL,
}: {
  shopId: string;
  customerId: string;
  subject: string;
  inReplyTo?: string | null;
  messageId?: string | null;
  body?: string | null;
  source?: TicketSource;
}) {
  // Try to find existing ticket by threading: look up a message with the same In-Reply-To
  if (inReplyTo) {
    const parentMessage = await db.ticketMessage.findFirst({
      where: { messageId: inReplyTo },
      select: { ticketId: true },
    });

    if (parentMessage) {
      const ticket = await db.ticket.findUnique({
        where: { id: parentMessage.ticketId, shopId },
      });

      if (ticket) {
        return { ticket, isNew: false };
      }
    }
  }

  // Fallback: replies to our outgoing mail carry "T-12345678" in the subject
  // even when the mail client or provider drops the threading headers.
  const subjectTicketNumber = subject.match(/\bT-\d{8}\b/)?.[0];
  if (subjectTicketNumber) {
    const bySubject = await db.ticket.findFirst({ where: { shopId, ticketNumber: subjectTicketNumber, customerId } });
    if (bySubject) {
      return { ticket: bySubject, isNew: false };
    }
  }

  // Check for dedup by messageId
  if (messageId) {
    const existingByMessageId = await db.ticketMessage.findFirst({
      where: { messageId },
      select: { ticketId: true },
    });

    if (existingByMessageId) {
      const ticket = await db.ticket.findUnique({
        where: { id: existingByMessageId.ticketId },
      });
      if (ticket) {
        return { ticket, isNew: false };
      }
    }
  }

  // Create new ticket
  const ticketNumber = `T-${Date.now().toString().slice(-8)}`;
  const ticket = await db.ticket.create({
    data: {
      shopId,
      customerId,
      ticketNumber,
      subject,
      source,
      status: TicketStatus.NEW,
      priority: "NORMAL",
      aiStatus: "PENDING",
      slaStatus: "ON_TIME",
      messages: body
        ? {
            create: {
              senderType: SenderType.CUSTOMER,
              body,
              isIncoming: true,
            },
          }
        : undefined,
    },
  });

  return { ticket, isNew: true };
}



export async function listTicketsForShop(shopId: string) {
  return db.ticket.findMany({
    where: { shopId },
    orderBy: { createdAt: "desc" },
    include: {
      customer: true,
      assignee: {
        select: {
          id: true,
          email: true,
          name: true,
        },
      },
    },
  });
}

export async function listTicketsForCustomerEmail(shopId: string, email: string, limit = 10) {
  const normalizedEmail = email.trim().toLowerCase();

  return db.ticket.findMany({
    where: { shopId, customer: { email: normalizedEmail } },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: {
      id: true,
      ticketNumber: true,
      subject: true,
      status: true,
      priority: true,
      category: true,
      createdAt: true,
    },
  });
}

export async function createTicketMessage({
  ticketId,
  body,
  senderUserId,
  senderType = SenderType.AGENT,
  isIncoming = false,
  messageId,
  inReplyTo,
  references,
}: {
  ticketId: string;
  body: string;
  senderUserId?: string | null;
  senderType?: SenderType;
  isIncoming?: boolean;
  messageId?: string | null;
  inReplyTo?: string | null;
  references?: string | null;
}) {
  const message = await db.ticketMessage.create({
    data: {
      ticketId,
      body,
      bodyHtml: body,
      senderUserId: senderUserId ?? null,
      senderType,
      isIncoming,
      messageId: messageId ?? undefined,
      inReplyTo: inReplyTo ?? undefined,
      references: references ?? undefined,
    },
  });

  await db.ticket.update({
    where: { id: ticketId },
    data: {
      lastMessageAt: new Date(),
      updatedAt: new Date(),
    },
  });

  return message;
}

export async function createInternalNote({
  ticketId,
  authorUserId,
  body,
  isVisibleToCustomer = false,
}: {
  ticketId: string;
  authorUserId?: string | null;
  body: string;
  isVisibleToCustomer?: boolean;
}) {
  return db.internalNote.create({
    data: {
      ticketId,
      authorId: authorUserId ?? null,
      body,
      isVisibleToCustomer,
    },
    include: {
      author: {
        select: {
          id: true,
          email: true,
          name: true,
        },
      },
    },
  });
}

export async function updateTicketAssignmentAndStatus({
  ticketId,
  shopId,
  status,
  assigneeId,
  priority,
  actorUserId,
}: {
  ticketId: string;
  shopId: string;
  status?: TicketStatus;
  assigneeId?: string | null;
  priority?: string | null;
  actorUserId?: string | null;
}) {
  const existingTicket = await db.ticket.findUnique({
    where: { id: ticketId, shopId },
    select: {
      assigneeId: true,
      status: true,
      priority: true,
    },
  });

  if (!existingTicket) {
    throw new Error("Ticket not found");
  }

  const nextAssigneeId = assigneeId ?? null;
  const previousAssigneeId = existingTicket.assigneeId ?? null;
  const nextStatus = status ?? existingTicket.status;
  const nextPriority = priority ?? existingTicket.priority;

  const updatedTicket = await db.ticket.update({
    where: { id: ticketId, shopId },
    data: {
      status: nextStatus,
      assigneeId: nextAssigneeId,
      priority: nextPriority,
      updatedAt: new Date(),
    },
  });

  if (previousAssigneeId !== nextAssigneeId) {
    await db.assignmentHistory.create({
      data: {
        ticketId,
        actorUserId: actorUserId ?? null,
        fromUserId: previousAssigneeId,
        toUserId: nextAssigneeId,
        reason: "assignment_change",
      },
    });
  }

  if (status && status !== existingTicket.status) {
    await db.assignmentHistory.create({
      data: {
        ticketId,
        actorUserId: actorUserId ?? null,
        fromUserId: previousAssigneeId,
        toUserId: nextAssigneeId,
        reason: `status_change:${status}`,
      },
    });
  }

  if (priority && priority !== existingTicket.priority) {
    await db.assignmentHistory.create({
      data: {
        ticketId,
        actorUserId: actorUserId ?? null,
        fromUserId: previousAssigneeId,
        toUserId: nextAssigneeId,
        reason: `priority_change:${priority}`,
      },
    });
  }

  return updatedTicket;
}

export async function toggleTicketFollower({
  ticketId,
  shopId,
  userId,
}: {
  ticketId: string;
  shopId: string;
  userId: string;
}) {
  const ticket = await db.ticket.findUnique({
    where: { id: ticketId, shopId },
    select: { id: true },
  });

  if (!ticket) {
    throw new Error("Ticket not found");
  }

  const existingFollower = await db.ticketFollower.findUnique({
    where: {
      ticketId_userId: {
        ticketId,
        userId,
      },
    },
  });

  if (existingFollower) {
    await db.ticketFollower.delete({
      where: { id: existingFollower.id },
    });

    return { isFollowing: false };
  }

  await db.ticketFollower.create({
    data: {
      ticketId,
      userId,
    },
  });

  return { isFollowing: true };
}

export async function createTicketForShop({
  shopId,
  subject,
  customerEmail,
  source = TicketSource.EMAIL,
}: {
  shopId: string;
  subject: string;
  customerEmail?: string | null;
  source?: TicketSource;
}) {
  let customer = null;

  if (customerEmail) {
    customer = await db.customer.findFirst({
      where: { shopId, email: customerEmail.trim() },
    });

    if (!customer) {
      customer = await db.customer.create({
        data: {
          shopId,
          email: customerEmail.trim(),
          firstName: customerEmail.split("@")[0],
        },
      });
    }
  }

  const ticketNumber = `T-${Date.now().toString().slice(-8)}`;

  return db.ticket.create({
    data: {
      shopId,
      customerId: customer?.id ?? null,
      ticketNumber,
      subject,
      status: TicketStatus.NEW,
      source,
      priority: "NORMAL",
      aiStatus: "PENDING",
      slaStatus: "ON_TIME",
      createdAt: new Date(),
    },
    include: {
      customer: true,
    },
  });
}
