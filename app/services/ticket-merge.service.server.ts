import db from "../db.server";
import { logAuditEvent } from "./audit.service.server";

export async function findPotentialDuplicateTickets({
  shopId,
  customerId,
  subject,
  excludeTicketId,
}: {
  shopId: string;
  customerId?: string | null;
  subject: string;
  excludeTicketId?: string;
}) {
  const since = new Date(Date.now() - 1000 * 60 * 60 * 48); // last 48h

  const candidates = await db.ticket.findMany({
    where: {
      shopId,
      status: { notIn: ["RESOLVED", "CLOSED"] },
      createdAt: { gte: since },
      ...(excludeTicketId ? { id: { not: excludeTicketId } } : {}),
      OR: [
        ...(customerId ? [{ customerId }] : []),
        { subject: { contains: subject.slice(0, 15), mode: "insensitive" as const } },
      ],
    },
    take: 5,
    orderBy: { createdAt: "desc" },
  });

  return candidates;
}

export async function mergeTickets({
  sourceTicketId,
  targetTicketId,
  shopId,
  actorUserId,
}: {
  sourceTicketId: string;
  targetTicketId: string;
  shopId: string;
  actorUserId: string;
}) {
  if (sourceTicketId === targetTicketId) {
    throw new Error("Cannot merge a ticket into itself");
  }

  const [sourceTicket, targetTicket] = await Promise.all([
    db.ticket.findFirst({ where: { id: sourceTicketId, shopId } }),
    db.ticket.findFirst({ where: { id: targetTicketId, shopId } }),
  ]);

  if (!sourceTicket || !targetTicket) {
    throw new Error("Source or target ticket not found");
  }

  // Move messages from source to target
  await db.ticketMessage.updateMany({
    where: { ticketId: sourceTicketId },
    data: { ticketId: targetTicketId },
  });

  // Move internal notes from source to target
  await db.internalNote.updateMany({
    where: { ticketId: sourceTicketId },
    data: { ticketId: targetTicketId },
  });

  // Add system internal note to target ticket
  await db.internalNote.create({
    data: {
      ticketId: targetTicketId,
      authorId: actorUserId,
      body: `System: Ticket #${sourceTicket.ticketNumber} ("${sourceTicket.subject}") was merged into this ticket.`,
    },
  });

  // Close source ticket
  await db.ticket.update({
    where: { id: sourceTicketId },
    data: {
      status: "CLOSED",
      closedAt: new Date(),
    },
  });

  // Audit event
  await logAuditEvent({
    shopId,
    actorUserId,
    entityType: "ticket",
    entityId: targetTicketId,
    eventType: "ticket.merged",
    details: {
      sourceTicketId,
      sourceTicketNumber: sourceTicket.ticketNumber,
      targetTicketId,
      targetTicketNumber: targetTicket.ticketNumber,
    },
    ticketId: targetTicketId,
  });

  return targetTicket;
}
