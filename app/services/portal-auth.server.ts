import crypto from "node:crypto";
import { RoleName } from "@prisma/client";
import db from "../db.server";
import { appConfig } from "../lib/config.server";
import { ensureDefaultRolesForShop, ensureUserMembership } from "./authorization.server";

const TOKEN_TTL_MS = 1000 * 60 * 15;

export function hashToken(value: string) {
  return crypto.createHmac("sha256", appConfig.TOKEN_HASH_SECRET).update(value).digest("hex");
}

/**
 * Who may request a sign-in link: an active member of a shop (keeps their current role) or
 * someone with a pending, unexpired invitation. Anyone else gets nothing, so a sign-in link can
 * never be used to create access to a shop.
 */
export async function findLoginTarget(email: string): Promise<{
  shopId: string;
  roleName: RoleName;
  name: string | null;
} | null> {
  const normalizedEmail = email.trim().toLowerCase();

  const membership = await db.shopMembership.findFirst({
    where: { status: "ACTIVE", user: { email: normalizedEmail, isActive: true } },
    include: { role: true, user: true },
    orderBy: { createdAt: "asc" },
  });
  if (membership) {
    return { shopId: membership.shopId, roleName: membership.role.name, name: membership.user.name };
  }

  const invitation = await db.invitation.findFirst({
    where: { email: normalizedEmail, status: "PENDING", expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "desc" },
  });
  if (!invitation) return null;

  const role = invitation.roleId ? await db.role.findUnique({ where: { id: invitation.roleId } }) : null;
  return { shopId: invitation.shopId, roleName: role?.name ?? RoleName.AGENT, name: invitation.name };
}

/** Sign-in links requested for this address in the last 15 minutes, to limit mail flooding. */
export function countRecentMagicLinks(email: string) {
  return db.invitation.count({
    where: {
      email: email.trim().toLowerCase(),
      tokenHash: { not: null },
      createdAt: { gt: new Date(Date.now() - TOKEN_TTL_MS) },
    },
  });
}

export async function createMagicLinkToken({
  shopId,
  email,
  name,
  roleName,
}: {
  shopId: string;
  email: string;
  name?: string | null;
  roleName: RoleName;
}) {
  const normalizedEmail = email.trim().toLowerCase();
  const token = crypto.randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + TOKEN_TTL_MS);

  await ensureDefaultRolesForShop(shopId);
  const role = await db.role.findUnique({
    where: { shopId_name: { shopId, name: roleName } },
  });

  const invitation = await db.invitation.create({
    data: {
      shopId,
      email: normalizedEmail,
      name: name ?? normalizedEmail,
      roleId: role?.id ?? null,
      status: "PENDING",
      tokenHash: hashToken(token),
      expiresAt,
    },
  });

  return { token, invitation };
}

export async function verifyMagicLinkToken({
  email,
  token,
  shopId,
}: {
  email: string;
  token: string;
  shopId?: string;
}) {
  const hashed = hashToken(token);
  const normalizedEmail = email.trim().toLowerCase();

  const invitation = await db.invitation.findFirst({
    where: {
      email: normalizedEmail,
      tokenHash: hashed,
      status: "PENDING",
      ...(shopId ? { shopId } : {}),
      expiresAt: {
        gt: new Date(),
      },
    },
    orderBy: {
      createdAt: "desc",
    },
  });

  return invitation;
}

export async function acceptMagicLinkToken({
  email,
  token,
  shopId,
}: {
  email: string;
  token: string;
  shopId?: string;
}) {
  const invitation = await verifyMagicLinkToken({ email, token, shopId });

  if (!invitation) {
    return null;
  }

  const role = invitation.roleId
    ? await db.role.findUnique({ where: { id: invitation.roleId } })
    : null;

  const resolvedShopId = invitation.shopId;
  const resolvedRoleName = role?.name ?? RoleName.AGENT;

  const { user } = await ensureUserMembership({
    shopId: resolvedShopId,
    email: invitation.email,
    name: invitation.name ?? invitation.email,
    roleName: resolvedRoleName,
  });

  await db.invitation.update({
    where: { id: invitation.id },
    data: {
      status: "USED",
      usedAt: new Date(),
    },
  });

  return {
    shopId: resolvedShopId,
    user,
    roleName: resolvedRoleName,
  };
}

export function createPortalSessionCookie(session: { email: string; shopId: string; userId: string }) {
  const payload = Buffer.from(JSON.stringify(session)).toString("base64url");
  const sig = crypto
    .createHmac("sha256", appConfig.TOKEN_HASH_SECRET)
    .update(payload)
    .digest("hex");
  const cookieValue = `${payload}.${sig}`;
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";

  return `portal_session=${cookieValue}; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400${secure}`;
}

export function readPortalSessionCookie(request: Request) {
  const cookieHeader = request.headers.get("Cookie") ?? "";
  const raw = cookieHeader
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith("portal_session="));

  if (!raw) {
    return null;
  }

  try {
    const cookieValue = raw.slice("portal_session=".length);
    const dotIndex = cookieValue.lastIndexOf(".");
    if (dotIndex === -1) return null;

    const payload = cookieValue.slice(0, dotIndex);
    const providedSig = cookieValue.slice(dotIndex + 1);

    const expectedSig = crypto
      .createHmac("sha256", appConfig.TOKEN_HASH_SECRET)
      .update(payload)
      .digest("hex");

    if (!crypto.timingSafeEqual(Buffer.from(expectedSig, "hex"), Buffer.from(providedSig, "hex"))) {
      return null;
    }

    const value = Buffer.from(payload, "base64url").toString("utf8");
    const session = JSON.parse(value) as { email: string; shopId: string; userId: string };

    if (!session.email || !session.shopId || !session.userId) {
      return null;
    }

    return session;
  } catch {
    return null;
  }
}
