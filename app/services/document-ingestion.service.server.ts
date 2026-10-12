import db from "../db.server";
import { chunkAndEmbedDocument } from "./knowledge.service.server";
import { getDecryptedShopAccessToken } from "./shop.service.server";

export async function parseUrlContent(url: string): Promise<string> {
  try {
    const response = await fetch(url, { headers: { "User-Agent": "Shopify-AI-Support-Bot/1.0" } });
    if (!response.ok) throw new Error(`HTTP ${response.status} fetching URL`);
    const html = await response.text();

    // Strip HTML tags & scripts to extract clean text
    const cleanText = html
      .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
      .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    return cleanText;
  } catch (err) {
    console.error("[document-ingestion] Failed to fetch URL content:", err);
    throw err;
  }
}

/** Shopify reports most failures (missing scopes, bad fields) as GraphQL errors on an HTTP 200. */
function assertNoGraphqlErrors(json: unknown, what: string) {
  const errors = (json as { errors?: Array<{ message?: string; extensions?: { code?: string; requiredAccess?: string } }> }).errors;
  if (!errors?.length) return;

  const denied = errors.find((error) => error.extensions?.code === "ACCESS_DENIED");
  if (denied) {
    throw new Error(
      `Shopify denied access to ${what}. The app is missing a permission: ${denied.extensions?.requiredAccess ?? denied.message ?? "unknown"}`,
    );
  }
  throw new Error(`Shopify returned an error for ${what}: ${errors.map((error) => error.message).join("; ").slice(0, 300)}`);
}

export async function syncShopifyPagesToKnowledge(shopId: string, shopDomain: string) {
  const token = await getDecryptedShopAccessToken(shopId);
  if (!token) throw new Error("No shop access token available");

  const query = `#graphql
    query getPages {
      pages(first: 25) {
        edges {
          node {
            id
            title
            body
            handle
            updatedAt
          }
        }
      }
    }
  `;

  const res = await fetch(`https://${shopDomain}/admin/api/2026-07/graphql.json`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": token,
    },
    body: JSON.stringify({ query }),
  });

  if (!res.ok) throw new Error(`Shopify API error ${res.status}`);

  const json = (await res.json()) as {
    data?: {
      pages?: {
        edges?: Array<{
          node?: {
            id: string;
            title: string;
            body: string;
            handle: string;
          };
        }>;
      };
    };
  };

  assertNoGraphqlErrors(json, "pages");
  const pages = json.data?.pages?.edges ?? [];
  const syncedDocs = [];

  for (const edge of pages) {
    if (!edge.node) continue;
    const { title, body, handle } = edge.node;
    const cleanBody = body.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

    const doc = await db.knowledgeDocument.upsert({
      where: { id: `shopify-page-${shopId}-${handle}` },
      update: {
        title: `[Shopify Page] ${title}`,
        content: cleanBody,
        status: "PUBLISHED",
      },
      create: {
        id: `shopify-page-${shopId}-${handle}`,
        shopId,
        title: `[Shopify Page] ${title}`,
        sourceType: "SHOPIFY_PAGE",
        sourceUrl: `https://${shopDomain}/pages/${handle}`,
        content: cleanBody,
        status: "PUBLISHED",
        authorName: "Shopify Sync",
      },
    });

    await chunkAndEmbedDocument(doc.id);
    syncedDocs.push(doc);
  }

  return syncedDocs;
}

export async function syncShopifyProductsToKnowledge(shopId: string, shopDomain: string) {
  const token = await getDecryptedShopAccessToken(shopId);
  if (!token) throw new Error("No shop access token available");

  const query = `#graphql
    query getProducts {
      products(first: 50) {
        edges {
          node {
            id
            title
            description
            handle
            productType
            vendor
          }
        }
      }
    }
  `;

  const res = await fetch(`https://${shopDomain}/admin/api/2026-07/graphql.json`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": token,
    },
    body: JSON.stringify({ query }),
  });

  if (!res.ok) throw new Error(`Shopify API error ${res.status}`);

  const json = (await res.json()) as {
    data?: {
      products?: {
        edges?: Array<{
          node?: {
            id: string;
            title: string;
            description: string;
            handle: string;
            productType: string;
            vendor: string;
          };
        }>;
      };
    };
  };

  assertNoGraphqlErrors(json, "products");
  const products = json.data?.products?.edges ?? [];
  const syncedDocs = [];

  for (const edge of products) {
    if (!edge.node) continue;
    const { title, description, handle, productType, vendor } = edge.node;
    const cleanDesc = (description || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    const content = `Product Title: ${title}\nVendor: ${vendor}\nType: ${productType}\nDescription: ${cleanDesc}`;

    const doc = await db.knowledgeDocument.upsert({
      where: { id: `shopify-product-${shopId}-${handle}` },
      update: {
        title: `[Product] ${title}`,
        content,
        status: "PUBLISHED",
      },
      create: {
        id: `shopify-product-${shopId}-${handle}`,
        shopId,
        title: `[Product] ${title}`,
        sourceType: "SHOPIFY_PRODUCT",
        sourceUrl: `https://${shopDomain}/products/${handle}`,
        content,
        status: "PUBLISHED",
        authorName: "Shopify Sync",
      },
    });

    await chunkAndEmbedDocument(doc.id);
    syncedDocs.push(doc);
  }

  return syncedDocs;
}
