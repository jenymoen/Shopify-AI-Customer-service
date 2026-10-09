import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { payload, session, topic, shop } = await authenticate.webhook(request);
  console.log(`Received ${topic} webhook for ${shop}`);

  const current = payload.current as string[];
  const scopes = current ?? [];

  if (session) {
    await db.session.update({
      where: {
        id: session.id,
      },
      data: {
        scope: scopes.join(","),
      },
    });
  }

  const shopRecord = await db.shop.findUnique({ where: { domain: shop } });

  if (shopRecord) {
    await db.shopifyInstallation.upsert({
      where: { shopId: shopRecord.id },
      update: {
        scopes,
        lastSyncedAt: new Date(),
        updatedAt: new Date(),
      },
      create: {
        shopId: shopRecord.id,
        shopifyShopDomain: shop,
        accessTokenEncrypted: "",
        scopes,
        installedAt: new Date(),
        lastSyncedAt: new Date(),
      },
    }).catch(() => undefined);
  }

  return new Response();
};
