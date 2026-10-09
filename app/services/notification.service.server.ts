import db from "../db.server";
import { logAuditEvent } from "./audit.service.server";

export async function createNotification({
  shopId,
  userId,
  ticketId,
  type,
  title,
  message,
}: {
  shopId: string;
  userId: string;
  ticketId?: string | null;
  type: "MENTION" | "ASSIGNMENT" | "TRANSFER" | "CUSTOMER_REPLY" | "SLA_WARNING" | "COLLABORATOR_INVITE" | "SYSTEM";
  title: string;
  message: string;
}) {
  return db.notification.create({
    data: {
      shopId,
      userId,
      ticketId: ticketId ?? null,
      type,
      title,
      message,
    },
  });
}

export async function listNotificationsForUser({
  shopId,
  userId,
  limit = 20,
}: {
  shopId: string;
  userId: string;
  limit?: number;
}) {
  return db.notification.findMany({
    where: { shopId, userId },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
}

export async function markNotificationAsRead({
  notificationId,
  userId,
}: {
  notificationId: string;
  userId: string;
}) {
  return db.notification.updateMany({
    where: { id: notificationId, userId },
    data: { isRead: true },
  });
}

export async function detectAndNotifyMentions({
  shopId,
  ticketId,
  body,
  actorUserId,
}: {
  shopId: string;
  ticketId: string;
  body: string;
  actorUserId: string;
}) {
  // Find all users in the shop
  const shopMembers = await db.shopMembership.findMany({
    where: { shopId },
    include: { user: true },
  });

  const mentionedUsers = shopMembers.filter((m) => {
    if (m.userId === actorUserId) return false;
    const name = m.user.name?.toLowerCase();
    const email = m.user.email.toLowerCase();
    const text = body.toLowerCase();

    return (
      text.includes(`@${email}`) ||
      (name && text.includes(`@${name}`))
    );
  });

  const notifications = [];
  for (const member of mentionedUsers) {
    const notif = await createNotification({
      shopId,
      userId: member.userId,
      ticketId,
      type: "MENTION",
      title: "You were mentioned in a ticket note",
      message: body.slice(0, 140),
    });
    notifications.push(notif);

    await logAuditEvent({
      shopId,
      actorUserId,
      entityType: "notification",
      entityId: notif.id,
      eventType: "notification.mention_sent",
      details: { recipientUserId: member.userId, ticketId },
      ticketId,
    });
  }

  return notifications;
}
