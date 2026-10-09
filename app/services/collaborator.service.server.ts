import crypto from "node:crypto";
import db from "../db.server";
import { appConfig } from "../lib/config.server";
import { logAuditEvent } from "./audit.service.server";
import { createNotification } from "./notification.service.server";

function hashToken(value: string) {
  return crypto.createHmac("sha256", appConfig.TOKEN_HASH_SECRET).update(value).digest("hex");
}

export async function inviteTicketCollaborator({
  ticketId,
  shopId,
  email,
  name,
  canReplyToCustomer = false,
  expiryDays = 7,
  actorUserId,
}: {
  ticketId: string;
  shopId: string;
  email: string;
  name?: string;
  canReplyToCustomer?: boolean;
  expiryDays?: number;
  actorUserId?: string;
}) {
  const normalizedEmail = email.trim().toLowerCase();
  const token = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * expiryDays);

  const collaborator = await db.ticketCollaborator.create({
    data: {
      ticketId,
      email: normalizedEmail,
      name: name?.trim() ?? normalizedEmail,
      invitedByUserId: actorUserId ?? null,
      canReplyToCustomer,
      expiresAt,
      tokenHash: hashToken(token),
    },
  });

  if (actorUserId) {
    await logAuditEvent({
      shopId,
      actorUserId,
      entityType: "ticket_collaborator",
      entityId: collaborator.id,
      eventType: "ticket.collaborator.invited",
      details: { email: normalizedEmail, canReplyToCustomer },
      ticketId,
    });
  }

  return { token, collaborator };
}

export async function listCollaboratorsForTicket(ticketId: string) {
  return db.ticketCollaborator.findMany({
    where: { ticketId },
    include: {
      invitedByUser: {
        select: { id: true, name: true, email: true },
      },
    },
    orderBy: { createdAt: "desc" },
  });
}

export async function removeCollaborator({
  collaboratorId,
  shopId,
  actorUserId,
}: {
  collaboratorId: string;
  shopId: string;
  actorUserId?: string;
}) {
  const collaborator = await db.ticketCollaborator.findUnique({
    where: { id: collaboratorId },
  });

  if (!collaborator) return;

  await db.ticketCollaborator.delete({
    where: { id: collaboratorId },
  });

  if (actorUserId) {
    await logAuditEvent({
      shopId,
      actorUserId,
      entityType: "ticket_collaborator",
      entityId: collaboratorId,
      eventType: "ticket.collaborator.removed",
      details: { email: collaborator.email },
      ticketId: collaborator.ticketId,
    });
  }
}

export async function expireCollaboratorsOnTicketClose(ticketId: string) {
  await db.ticketCollaborator.deleteMany({
    where: { ticketId },
  });
}
