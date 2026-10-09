import { Prisma } from "@prisma/client";
import db from "../db.server";

export interface AuditEventInput {
  shopId: string;
  actorUserId?: string | null;
  entityType: string;
  entityId?: string | null;
  eventType: string;
  details?: Record<string, unknown> | null;
  ticketId?: string | null;
}

export async function logAuditEvent({
  shopId,
  actorUserId,
  entityType,
  entityId,
  eventType,
  details,
  ticketId,
}: AuditEventInput) {
  try {
    const actorUser = actorUserId ? await db.user.findUnique({ where: { id: actorUserId } }) : null;

    await db.auditEvent.create({
      data: {
        shopId,
        actorUserId: actorUser?.id ?? null,
        entityType,
        entityId: entityId ?? null,
        eventType,
        details: details ? (details as Prisma.InputJsonValue) : Prisma.JsonNull,
        ticketId: ticketId ?? null,
      },
    });
  } catch (err) {
    // Audit log writes must never crash the main flow
    console.error("[audit] Failed to write audit event:", err);
  }
}

