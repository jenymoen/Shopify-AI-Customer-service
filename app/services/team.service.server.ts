import db from "../db.server";
import { logAuditEvent } from "./audit.service.server";

export async function createTeam({
  shopId,
  name,
  description,
  actorUserId,
}: {
  shopId: string;
  name: string;
  description?: string;
  actorUserId?: string;
}) {
  const team = await db.team.create({
    data: {
      shopId,
      name: name.trim(),
      description: description?.trim() ?? null,
    },
  });

  if (actorUserId) {
    await logAuditEvent({
      shopId,
      actorUserId,
      entityType: "team",
      entityId: team.id,
      eventType: "team.created",
      details: { name: team.name },
    });
  }

  return team;
}

export async function listTeamsForShop(shopId: string) {
  return db.team.findMany({
    where: { shopId },
    include: {
      members: {
        include: {
          user: {
            select: {
              id: true,
              email: true,
              name: true,
              avatarUrl: true,
            },
          },
        },
      },
      _count: {
        select: {
          tickets: true,
          members: true,
        },
      },
    },
    orderBy: { name: "asc" },
  });
}

export async function addMemberToTeam({
  teamId,
  userId,
  role = "MEMBER",
  actorUserId,
}: {
  teamId: string;
  userId: string;
  role?: string;
  actorUserId?: string;
}) {
  const team = await db.team.findUnique({ where: { id: teamId } });
  if (!team) throw new Error("Team not found");

  const membership = await db.teamMembership.upsert({
    where: {
      teamId_userId: {
        teamId,
        userId,
      },
    },
    update: { role },
    create: {
      teamId,
      userId,
      role,
    },
  });

  if (actorUserId) {
    await logAuditEvent({
      shopId: team.shopId,
      actorUserId,
      entityType: "team",
      entityId: teamId,
      eventType: "team.member.added",
      details: { userId, role },
    });
  }

  return membership;
}

export async function removeMemberFromTeam({
  teamId,
  userId,
  actorUserId,
}: {
  teamId: string;
  userId: string;
  actorUserId?: string;
}) {
  const team = await db.team.findUnique({ where: { id: teamId } });
  if (!team) throw new Error("Team not found");

  await db.teamMembership.deleteMany({
    where: { teamId, userId },
  });

  if (actorUserId) {
    await logAuditEvent({
      shopId: team.shopId,
      actorUserId,
      entityType: "team",
      entityId: teamId,
      eventType: "team.member.removed",
      details: { userId },
    });
  }
}

export async function assignTicketToTeam({
  ticketId,
  shopId,
  teamId,
  actorUserId,
}: {
  ticketId: string;
  shopId: string;
  teamId: string | null;
  actorUserId?: string;
}) {
  const updatedTicket = await db.ticket.update({
    where: { id: ticketId, shopId },
    data: { teamId },
  });

  if (actorUserId) {
    await logAuditEvent({
      shopId,
      actorUserId,
      entityType: "ticket",
      entityId: ticketId,
      eventType: "ticket.team_assigned",
      details: { teamId },
      ticketId,
    });
  }

  return updatedTicket;
}
