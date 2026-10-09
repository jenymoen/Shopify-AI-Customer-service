import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, session, topic } = await authenticate.webhook(request);

  console.log(`Received ${topic} webhook for ${shop}`);

  const shopRecord = await db.shop.findUnique({ where: { domain: shop } });

  if (shopRecord) {
    await db.shop.update({
      where: { id: shopRecord.id },
      data: {
        status: "UNINSTALLED",
        updatedAt: new Date(),
      },
    });

    await db.shopifyInstallation.update({
      where: { shopId: shopRecord.id },
      data: {
        uninstalledAt: new Date(),
        updatedAt: new Date(),
      },
    }).catch(() => undefined);
  }

  if (session) {
    await db.session.deleteMany({ where: { shop } });
  }

  return new Response();
};
