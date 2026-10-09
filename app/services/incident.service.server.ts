import db from "../db.server";
import { logAuditEvent } from "./audit.service.server";

export async function createIncident({
  shopId,
  title,
  description,
  keywords = [],
  actorUserId,
}: {
  shopId: string;
  title: string;
  description?: string;
  keywords?: string[];
  actorUserId?: string;
}) {
  const incident = await db.incident.create({
    data: {
      shopId,
      title: title.trim(),
      description: description?.trim() ?? null,
      keywords: keywords.map((k) => k.trim().toLowerCase()).filter(Boolean),
      status: "INVESTIGATING",
    },
  });

  if (actorUserId) {
    await logAuditEvent({
      shopId,
      actorUserId,
      entityType: "incident",
      entityId: incident.id,
      eventType: "incident.created",
      details: { title: incident.title, keywords: incident.keywords },
    });
  }

  // Auto-link any matching tickets open in the shop
  if (keywords.length > 0) {
    await autoLinkMatchingTicketsToIncident({ shopId, incidentId: incident.id });
  }

  return incident;
}

export async function listIncidentsForShop(shopId: string) {
  return db.incident.findMany({
    where: { shopId },
    include: {
      tickets: {
        include: {
          ticket: true,
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });
}

export async function linkTicketToIncident({
  incidentId,
  ticketId,
}: {
  incidentId: string;
  ticketId: string;
}) {
  return db.incidentTicket.upsert({
    where: {
      incidentId_ticketId: {
        incidentId,
        ticketId,
      },
    },
    update: {},
    create: {
      incidentId,
      ticketId,
    },
  });
}

export async function autoLinkMatchingTicketsToIncident({
  shopId,
  incidentId,
}: {
  shopId: string;
  incidentId: string;
}) {
  const incident = await db.incident.findUnique({ where: { id: incidentId } });
  if (!incident || incident.keywords.length === 0) return [];

  const openTickets = await db.ticket.findMany({
    where: {
      shopId,
      status: { notIn: ["RESOLVED", "CLOSED"] },
    },
  });

  const linked = [];
  for (const t of openTickets) {
    const subject = t.subject.toLowerCase();
    const isMatch = incident.keywords.some((kw) => subject.includes(kw));

    if (isMatch) {
      const link = await linkTicketToIncident({ incidentId, ticketId: t.id });
      linked.push(link);
    }
  }

  return linked;
}

export async function resolveIncidentAndCloseTickets({
  incidentId,
  shopId,
  resolutionNote,
  actorUserId,
}: {
  incidentId: string;
  shopId: string;
  resolutionNote: string;
  actorUserId: string;
}) {
  const incident = await db.incident.findUnique({
    where: { id: incidentId },
    include: { tickets: true },
  });

  if (!incident) throw new Error("Incident not found");

  const ticketIds = incident.tickets.map((t) => t.ticketId);

  // Bulk update all linked tickets to RESOLVED
  if (ticketIds.length > 0) {
    await db.ticket.updateMany({
      where: { id: { in: ticketIds } },
      data: {
        status: "RESOLVED",
        resolvedAt: new Date(),
      },
    });

    // Check if actorUserId is a valid user
    const actorUser = actorUserId ? await db.user.findUnique({ where: { id: actorUserId } }) : null;

    // Add internal note to each linked ticket
    for (const tId of ticketIds) {
      await db.internalNote.create({
        data: {
          ticketId: tId,
          authorId: actorUser?.id ?? null,
          body: `Incident Resolved ("${incident.title}"): ${resolutionNote}`,
        },
      });
    }
  }

  // Update incident status
  const updatedIncident = await db.incident.update({
    where: { id: incidentId },
    data: {
      status: "RESOLVED",
      resolvedAt: new Date(),
    },
  });

  await logAuditEvent({
    shopId,
    actorUserId,
    entityType: "incident",
    entityId: incidentId,
    eventType: "incident.resolved",
    details: { resolvedTicketsCount: ticketIds.length, resolutionNote },
  });

  return updatedIncident;
}
