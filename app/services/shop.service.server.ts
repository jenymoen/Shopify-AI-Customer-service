import { RoleName } from "@prisma/client";
import db from "../db.server";
import { decryptSecret, encryptSecret } from "../lib/crypto.server";
import { ensureDefaultRolesForShop, ensureUserMembership } from "./authorization.server";

export function normalizeShopDomain(domain: string) {
  return domain.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/$/, "");
}

type AdminGraphqlClient = {
  graphql: (query: string) => Promise<Response>;
};

async function fetchShopOwnerEmail(admin: AdminGraphqlClient) {
  const response = await admin.graphql(`#graphql
    query ShopOwnerEmail {
      shop {
        email
      }
    }`);
  const { data } = await response.json();
  return data?.shop?.email?.trim().toLowerCase() || null;
}

/**
 * Offline sessions carry no user identity, so a freshly installed shop would
 * otherwise have no members at all. Bootstrap an OWNER from the shop's email.
 */
export async function ensureShopOwnerMembership(shopId: string, admin?: AdminGraphqlClient) {
  if (!admin) return;

  const existing = await db.shopMembership.findFirst({ where: { shopId, status: "ACTIVE" } });
  if (existing) return;

  const email = await fetchShopOwnerEmail(admin);
  if (!email) return;

  await ensureDefaultRolesForShop(shopId);
  await ensureUserMembership({ shopId, email, roleName: RoleName.OWNER });
}

export async function ensureShopForSession(session: {
  shop: string;
  accessToken?: string | null;
  scope?: string | null;
  onlineAccessInfo?: {
    associated_user?: {
      email?: string | null;
      first_name?: string | null;
      last_name?: string | null;
    };
  };
}, admin?: AdminGraphqlClient) {
  const domain = normalizeShopDomain(session.shop);
  const accessToken = session.accessToken ?? "";

  const shop = await db.shop.upsert({
    where: { domain },
    update: {
      name: domain,
      domain,
      updatedAt: new Date(),
    },
    create: {
      domain,
      name: domain,
    },
  });

  await db.shopifyInstallation.upsert({
    where: { shopId: shop.id },
    update: {
      shopifyShopDomain: domain,
      accessTokenEncrypted: encryptSecret(accessToken),
      scopes: session.scope ? session.scope.split(",").map((value) => value.trim()).filter(Boolean) : [],
      lastSyncedAt: new Date(),
      updatedAt: new Date(),
    },
    create: {
      shopId: shop.id,
      shopifyShopDomain: domain,
      accessTokenEncrypted: encryptSecret(accessToken),
      scopes: session.scope ? session.scope.split(",").map((value) => value.trim()).filter(Boolean) : [],
      installedAt: new Date(),
      lastSyncedAt: new Date(),
    },
  });

  await ensureDefaultRolesForShop(shop.id);

  const sessionEmail = session.onlineAccessInfo?.associated_user?.email?.trim().toLowerCase();
  if (sessionEmail) {
    const firstName = session.onlineAccessInfo?.associated_user?.first_name ?? "";
    const lastName = session.onlineAccessInfo?.associated_user?.last_name ?? "";
    const name = [firstName, lastName].filter(Boolean).join(" ") || sessionEmail;
    await ensureUserMembership({
      shopId: shop.id,
      email: sessionEmail,
      name,
      roleName: RoleName.OWNER,
    });
  } else {
    await ensureShopOwnerMembership(shop.id, admin);
  }

  return shop;
}

export function getShopForSession(session: { shop: string }) {
  return db.shop.findUnique({ where: { domain: normalizeShopDomain(session.shop) } });
}

export function getShopInstallationForShop(shopId: string) {
  return db.shopifyInstallation.findUnique({ where: { shopId } });
}

export function getDecryptedShopAccessToken(shopId: string) {
  return db.shopifyInstallation.findUnique({ where: { shopId } }).then((installation) => {
    if (!installation) {
      return null;
    }

    return decryptSecret(installation.accessTokenEncrypted);
  });
}

