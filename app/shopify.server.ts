import "@shopify/shopify-app-react-router/adapters/node";
import {
  ApiVersion,
  AppDistribution,
  shopifyApp,
} from "@shopify/shopify-app-react-router/server";
import { PrismaSessionStorage } from "@shopify/shopify-app-session-storage-prisma";
import prisma from "./db.server";
import { ensureShopForSession } from "./services/shop.service.server";
import { ensureDefaultRolesForAllShops } from "./services/authorization.server";

const shopify = shopifyApp({
  apiKey: process.env.SHOPIFY_API_KEY,
  apiSecretKey: process.env.SHOPIFY_API_SECRET || "",
  apiVersion: ApiVersion.July26,
  scopes: process.env.SCOPES?.split(","),
  appUrl: process.env.SHOPIFY_APP_URL || "",
  authPathPrefix: "/auth",
  sessionStorage: new PrismaSessionStorage(prisma),
  distribution: AppDistribution.AppStore,
  future: {
    expiringOfflineAccessTokens: true,
  },
  hooks: {
    afterAuth: async ({ session, admin }) => {
      await ensureShopForSession(session, admin);
    },
  },
  ...(process.env.SHOP_CUSTOM_DOMAIN
    ? { customShopDomains: [process.env.SHOP_CUSTOM_DOMAIN] }
    : {}),
});

// Fire-and-forget on server start so existing shops pick up newly added permissions.
void ensureDefaultRolesForAllShops();

export default shopify;
export const apiVersion = ApiVersion.July26;
export const addDocumentResponseHeaders = shopify.addDocumentResponseHeaders;
export const authenticate = shopify.authenticate;
export const unauthenticated = shopify.unauthenticated;
export const login = shopify.login;
export const registerWebhooks = shopify.registerWebhooks;
export const sessionStorage = shopify.sessionStorage;

/**
 * Use Shopify auth when the request comes from inside Shopify Admin iframe
 * (identified by the `embedded=1` query param or a Shopify session token header).
 * Otherwise fall back to the first shop in the DB so routes are accessible
 * directly in the browser during local development.
 */
export async function authenticateAdminOrFallback(request: Request) {
  const url = new URL(request.url);
  const isEmbedded =
    url.searchParams.has("embedded") ||
    request.headers.has("authorization") ||
    request.headers.has("x-shopify-access-token");

  if (isEmbedded) {
    return shopify.authenticate.admin(request);
  }

  // Standalone / local dev — resolve first shop from DB
  const shop = await prisma.shop.findFirst({ orderBy: { createdAt: "asc" } });

  if (!shop) {
    throw new Response("No shop found. Install the app in a Shopify store first.", { status: 404 });
  }

  return {
    session: {
      shop: shop.domain,
      accessToken: "standalone-dev-token",
      onlineAccessInfo: {
        associated_user: { email: "admin@dev.local" },
      },
    },
  } as any;
}

