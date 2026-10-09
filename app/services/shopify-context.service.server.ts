import { getDecryptedShopAccessToken } from "./shop.service.server";

const SHOPIFY_API_VERSION = "2026-07";

interface ShopifyCustomerResult {
  id: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  phone: string | null;
  ordersCount: number;
  totalSpent: string;
  tags: string[];
  createdAt: string;
  verifiedEmail: boolean;
  state: string;
}

interface ShopifyOrderResult {
  id: string;
  name: string;
  createdAt: string;
  financialStatus: string;
  fulfillmentStatus: string | null;
  totalPrice: string;
  currency: string;
  lineItems: Array<{
    title: string;
    quantity: number;
    price: string;
  }>;
  trackingUrls: string[];
  cancelledAt: string | null;
  refunds: Array<{ amount: string; createdAt: string }>;
}

export async function lookupShopifyCustomerByEmail(
  shopId: string,
  email: string,
  shopDomain: string,
): Promise<ShopifyCustomerResult | null> {
  const accessToken = await getDecryptedShopAccessToken(shopId);
  if (!accessToken) return null;

  const query = `
    query lookupCustomerByEmail($query: String!) {
      customers(first: 1, query: $query) {
        edges {
          node {
            id
            firstName
            lastName
            email
            phone
            ordersCount
            totalSpentV2 { amount currencyCode }
            tags
            createdAt
            verifiedEmail
            state
          }
        }
      }
    }
  `;

  try {
    const res = await fetch(
      `https://${shopDomain}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Access-Token": accessToken,
        },
        body: JSON.stringify({ query, variables: { query: `email:${email}` } }),
      },
    );

    if (!res.ok) return null;

    const json = (await res.json()) as {
      data?: {
        customers?: {
          edges?: Array<{
            node?: {
              id: string;
              firstName: string | null;
              lastName: string | null;
              email: string | null;
              phone: string | null;
              ordersCount: number;
              totalSpentV2: { amount: string };
              tags: string[];
              createdAt: string;
              verifiedEmail: boolean;
              state: string;
            };
          }>;
        };
      };
    };

    const node = json.data?.customers?.edges?.[0]?.node;
    if (!node) return null;

    return {
      id: node.id,
      firstName: node.firstName,
      lastName: node.lastName,
      email: node.email,
      phone: node.phone,
      ordersCount: node.ordersCount,
      totalSpent: node.totalSpentV2.amount,
      tags: node.tags,
      createdAt: node.createdAt,
      verifiedEmail: node.verifiedEmail,
      state: node.state,
    };
  } catch (err) {
    console.error("[shopify-context] Failed to lookup customer:", err);
    return null;
  }
}

export async function lookupShopifyOrdersByEmail(
  shopId: string,
  email: string,
  shopDomain: string,
  limit = 5,
): Promise<ShopifyOrderResult[]> {
  const accessToken = await getDecryptedShopAccessToken(shopId);
  if (!accessToken) return [];

  const query = `
    query lookupOrdersByEmail($query: String!, $first: Int!) {
      orders(first: $first, query: $query, sortKey: CREATED_AT, reverse: true) {
        edges {
          node {
            id
            name
            createdAt
            financialStatus
            fulfillmentStatus
            totalPriceSet { shopMoney { amount currencyCode } }
            lineItems(first: 5) {
              edges {
                node {
                  title
                  quantity
                  originalUnitPriceSet { shopMoney { amount } }
                }
              }
            }
            fulfillments(first: 3) {
              trackingInfo { url }
            }
            cancelledAt
            refunds(first: 3) {
              createdAt
              totalRefundedSet { shopMoney { amount } }
            }
          }
        }
      }
    }
  `;

  try {
    const res = await fetch(
      `https://${shopDomain}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Access-Token": accessToken,
        },
        body: JSON.stringify({ query, variables: { query: `email:${email}`, first: limit } }),
      },
    );

    if (!res.ok) return [];

    const json = (await res.json()) as {
      data?: {
        orders?: {
          edges?: Array<{
            node?: {
              id: string;
              name: string;
              createdAt: string;
              financialStatus: string;
              fulfillmentStatus: string | null;
              totalPriceSet: { shopMoney: { amount: string; currencyCode: string } };
              lineItems: { edges: Array<{ node: { title: string; quantity: number; originalUnitPriceSet: { shopMoney: { amount: string } } } }> };
              fulfillments: Array<{ trackingInfo: Array<{ url: string }> }>;
              cancelledAt: string | null;
              refunds: Array<{ createdAt: string; totalRefundedSet: { shopMoney: { amount: string } } }>;
            };
          }>;
        };
      };
    };

    const orders = json.data?.orders?.edges ?? [];

    return orders
      .map((edge) => edge.node)
      .filter((node): node is NonNullable<typeof node> => !!node)
      .map((node) => ({
        id: node.id,
        name: node.name,
        createdAt: node.createdAt,
        financialStatus: node.financialStatus,
        fulfillmentStatus: node.fulfillmentStatus,
        totalPrice: node.totalPriceSet.shopMoney.amount,
        currency: node.totalPriceSet.shopMoney.currencyCode,
        lineItems: node.lineItems.edges.map((le) => ({
          title: le.node.title,
          quantity: le.node.quantity,
          price: le.node.originalUnitPriceSet.shopMoney.amount,
        })),
        trackingUrls: node.fulfillments.flatMap((f) => f.trackingInfo.map((t) => t.url)).filter(Boolean),
        cancelledAt: node.cancelledAt,
        refunds: node.refunds.map((r) => ({
          amount: r.totalRefundedSet.shopMoney.amount,
          createdAt: r.createdAt,
        })),
      }));
  } catch (err) {
    console.error("[shopify-context] Failed to lookup orders:", err);
    return [];
  }
}
