import crypto from "node:crypto";
import { RoleName } from "@prisma/client";
import db from "../db.server";
import { ensureDefaultRolesForShop } from "./authorization.server";
import { hashToken } from "./portal-auth.server";

export async function createInviteForShop({
  shopId,
  email,
  name,
  roleName = RoleName.AGENT,
  expiryDays = 14,
  invitedByUserId,
}: {
  shopId: string;
  email: string;
  name?: string | null;
  roleName?: RoleName;
  expiryDays?: number;
  invitedByUserId?: string | null;
}) {
  const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * expiryDays);
  const normalizedEmail = email.trim().toLowerCase();

  await ensureDefaultRolesForShop(shopId);

  const role = await db.role.findUnique({
    where: {
      shopId_name: {
        shopId,
        name: roleName,
      },
    },
  });

  if (!role) {
    throw new Error(`Role ${roleName} does not exist for shop ${shopId}`);
  }

  // The raw token only exists here and in the email; the database keeps a keyed hash of it.
  const token = crypto.randomBytes(32).toString("hex");

  const invitation = await db.invitation.create({
    data: {
      shopId,
      email: normalizedEmail,
      name: name ?? normalizedEmail,
      roleId: role.id,
      status: "PENDING",
      tokenHash: hashToken(token),
      expiresAt,
      invitedByUserId: invitedByUserId ?? null,
    },
  });

  return { invitation, token };
}

