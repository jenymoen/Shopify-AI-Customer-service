import { PermissionName } from "@prisma/client";
import db from "../db.server";
import { authenticate } from "../shopify.server";
import { normalizeShopDomain } from "./shop.service.server";
import { hasPermission, resolveShopUser } from "./authorization.server";

/** Resolves the shop for the current admin session and requires SHOPS_WRITE. Used by all settings pages. */
export async function requireShopSettingsAccess(request: Request) {
  const { session } = await authenticate.admin(request);

  const shop = await db.shop.findUnique({
    where: { domain: normalizeShopDomain(session.shop) },
  });

  if (!shop) {
    console.warn(`[settings] no Shop row for ${session.shop}`);
    throw new Response("Shop not found", { status: 404 });
  }

  const email = session.onlineAccessInfo?.associated_user?.email?.trim().toLowerCase();
  const user = await resolveShopUser({ shopId: shop.id, email });
  if (!user) {
    console.warn(`[settings] no member user for shop ${shop.domain} (session email: ${email ?? "none"})`);
    throw new Response("Access denied", { status: 403 });
  }

  const canWriteShop = await hasPermission({
    userId: user.id,
    shopId: shop.id,
    permission: PermissionName.SHOPS_WRITE,
  });

  if (!canWriteShop) {
    console.warn(`[settings] user ${user.id} lacks SHOPS_WRITE for shop ${shop.domain}`);
    throw new Response("Access denied", { status: 403 });
  }

  return shop;
}
