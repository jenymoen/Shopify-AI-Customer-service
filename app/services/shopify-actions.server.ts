// Shopify Admin GraphQL calls used exclusively by the AI Actions framework (app/services/actions.service.server.ts).
// Read helpers here return richer, action-oriented data (line item / fulfillment IDs) than shopify-context.service.server.ts,
// which only serves display purposes for the ticket UI.
import { getDecryptedShopAccessToken } from "./shop.service.server";

const SHOPIFY_API_VERSION = "2026-07";

async function shopifyGraphql<T>(
  shopId: string,
  shopDomain: string,
  query: string,
  variables: Record<string, unknown>,
): Promise<T> {
  const accessToken = await getDecryptedShopAccessToken(shopId);
  if (!accessToken) {
    throw new Error("Shop is not connected to Shopify (missing access token).");
  }

  const res = await fetch(`https://${shopDomain}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": accessToken,
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!res.ok) {
    throw new Error(`Shopify API request failed with status ${res.status}`);
  }

  const json = (await res.json()) as { data?: T; errors?: Array<{ message: string }> };

  if (json.errors?.length) {
    throw new Error(`Shopify API error: ${json.errors.map((e) => e.message).join("; ")}`);
  }

  if (!json.data) {
    throw new Error("Shopify API returned no data.");
  }

  return json.data;
}

// ── Reads ─────────────────────────────────────────────────────────────────────

export interface ShopifyOrderDetail {
  id: string;
  name: string;
  createdAt: string;
  financialStatus: string;
  fulfillmentStatus: string | null;
  totalPrice: string;
  currency: string;
  cancelledAt: string | null;
  totalRefundedAmount: string;
  lineItems: Array<{ id: string; title: string; quantity: number; price: string; fulfillmentLineItemId: string | null }>;
  trackingUrls: string[];
  trackingNumbers: string[];
}

const ORDER_DETAIL_FIELDS = `
  id
  name
  createdAt
  displayFinancialStatus
  displayFulfillmentStatus
  cancelledAt
  totalPriceSet { shopMoney { amount currencyCode } }
  totalRefundedSet { shopMoney { amount } }
  lineItems(first: 20) {
    edges {
      node {
        id
        title
        quantity
        originalUnitPriceSet { shopMoney { amount } }
      }
    }
  }
  fulfillments(first: 5) {
    trackingInfo { number url }
    fulfillmentLineItems(first: 20) {
      edges { node { id lineItem { id } } }
    }
  }
`;

function mapOrderNode(node: any): ShopifyOrderDetail {
  const fulfillmentLineItemByLineItemId = new Map<string, string>();
  for (const fulfillment of node.fulfillments ?? []) {
    for (const edge of fulfillment.fulfillmentLineItems?.edges ?? []) {
      fulfillmentLineItemByLineItemId.set(edge.node.lineItem.id, edge.node.id);
    }
  }

  return {
    id: node.id,
    name: node.name,
    createdAt: node.createdAt,
    financialStatus: node.displayFinancialStatus,
    fulfillmentStatus: node.displayFulfillmentStatus ?? null,
    totalPrice: node.totalPriceSet.shopMoney.amount,
    currency: node.totalPriceSet.shopMoney.currencyCode,
    cancelledAt: node.cancelledAt,
    totalRefundedAmount: node.totalRefundedSet.shopMoney.amount,
    lineItems: (node.lineItems?.edges ?? []).map((edge: any) => ({
      id: edge.node.id,
      title: edge.node.title,
      quantity: edge.node.quantity,
      price: edge.node.originalUnitPriceSet.shopMoney.amount,
      fulfillmentLineItemId: fulfillmentLineItemByLineItemId.get(edge.node.id) ?? null,
    })),
    trackingUrls: (node.fulfillments ?? []).flatMap((f: any) => f.trackingInfo.map((t: any) => t.url)).filter(Boolean),
    trackingNumbers: (node.fulfillments ?? []).flatMap((f: any) => f.trackingInfo.map((t: any) => t.number)).filter(Boolean),
  };
}

export async function getShopifyOrderByName(
  shopId: string,
  shopDomain: string,
  orderName: string,
): Promise<ShopifyOrderDetail | null> {
  const normalized = orderName.trim().replace(/^#/, "");

  const query = `
    query getOrderByName($query: String!) {
      orders(first: 1, query: $query) {
        edges { node { ${ORDER_DETAIL_FIELDS} } }
      }
    }
  `;

  const data = await shopifyGraphql<{ orders: { edges: Array<{ node: any }> } }>(shopId, shopDomain, query, {
    query: `name:#${normalized}`,
  });

  const node = data.orders.edges[0]?.node;
  return node ? mapOrderNode(node) : null;
}

export async function getShopifyOrderById(
  shopId: string,
  shopDomain: string,
  orderId: string,
): Promise<ShopifyOrderDetail | null> {
  const query = `
    query getOrderById($id: ID!) {
      order(id: $id) { ${ORDER_DETAIL_FIELDS} }
    }
  `;

  const data = await shopifyGraphql<{ order: any }>(shopId, shopDomain, query, { id: orderId });
  return data.order ? mapOrderNode(data.order) : null;
}

export interface ShopifyProductResult {
  id: string;
  title: string;
  handle: string;
  status: string;
  totalInventory: number;
  variants: Array<{ id: string; title: string; price: string; availableForSale: boolean }>;
}

export async function getShopifyProductByQuery(
  shopId: string,
  shopDomain: string,
  searchQuery: string,
  limit = 5,
): Promise<ShopifyProductResult[]> {
  const query = `
    query searchProducts($query: String!, $first: Int!) {
      products(first: $first, query: $query) {
        edges {
          node {
            id
            title
            handle
            status
            totalInventory
            variants(first: 10) {
              edges { node { id title price availableForSale } }
            }
          }
        }
      }
    }
  `;

  const data = await shopifyGraphql<{ products: { edges: Array<{ node: any }> } }>(shopId, shopDomain, query, {
    query: searchQuery,
    first: limit,
  });

  return data.products.edges.map((edge) => ({
    id: edge.node.id,
    title: edge.node.title,
    handle: edge.node.handle,
    status: edge.node.status,
    totalInventory: edge.node.totalInventory,
    variants: edge.node.variants.edges.map((v: any) => ({
      id: v.node.id,
      title: v.node.title,
      price: v.node.price,
      availableForSale: v.node.availableForSale,
    })),
  }));
}

// ── Writes ────────────────────────────────────────────────────────────────────

export interface ShopifyMutationResult {
  success: boolean;
  errors: string[];
  data?: Record<string, unknown>;
}

const CANCEL_REASONS = new Set(["CUSTOMER", "DECLINED", "FRAUD", "INVENTORY", "STAFF", "OTHER"]);

export async function cancelShopifyOrder(
  shopId: string,
  shopDomain: string,
  input: { orderId: string; reason: string; notifyCustomer: boolean; restock: boolean; refundToOriginal: boolean; staffNote?: string },
): Promise<ShopifyMutationResult> {
  const reason = CANCEL_REASONS.has(input.reason) ? input.reason : "OTHER";

  const query = `
    mutation OrderCancel($orderId: ID!, $notifyCustomer: Boolean, $refundMethod: OrderCancelRefundMethodInput!, $restock: Boolean!, $reason: OrderCancelReason!, $staffNote: String) {
      orderCancel(orderId: $orderId, notifyCustomer: $notifyCustomer, refundMethod: $refundMethod, restock: $restock, reason: $reason, staffNote: $staffNote) {
        job { id done }
        orderCancelUserErrors { field message code }
      }
    }
  `;

  const data = await shopifyGraphql<{
    orderCancel: { job: { id: string; done: boolean } | null; orderCancelUserErrors: Array<{ message: string }> };
  }>(shopId, shopDomain, query, {
    orderId: input.orderId,
    notifyCustomer: input.notifyCustomer,
    refundMethod: { originalPaymentMethodsRefund: input.refundToOriginal },
    restock: input.restock,
    reason,
    staffNote: input.staffNote ?? null,
  });

  const errors = data.orderCancel.orderCancelUserErrors.map((e) => e.message);
  return { success: errors.length === 0, errors, data: { jobId: data.orderCancel.job?.id ?? null } };
}

export async function refundShopifyOrder(
  shopId: string,
  shopDomain: string,
  input: { orderId: string; idempotencyKey: string; lineItems: Array<{ lineItemId: string; quantity: number }>; note?: string; notifyCustomer?: boolean },
): Promise<ShopifyMutationResult> {
  const query = `
    mutation RefundLineItems($input: RefundInput!, $idempotencyKey: String!) {
      refundCreate(input: $input) @idempotent(key: $idempotencyKey) {
        refund { id totalRefundedSet { shopMoney { amount currencyCode } } }
        userErrors { field message }
      }
    }
  `;

  const data = await shopifyGraphql<{
    refundCreate: { refund: { id: string; totalRefundedSet: { shopMoney: { amount: string; currencyCode: string } } } | null; userErrors: Array<{ message: string }> };
  }>(shopId, shopDomain, query, {
    idempotencyKey: input.idempotencyKey,
    input: {
      orderId: input.orderId,
      notify: input.notifyCustomer ?? true,
      note: input.note ?? null,
      refundLineItems: input.lineItems.map((li) => ({ lineItemId: li.lineItemId, quantity: li.quantity })),
      transactions: [],
    },
  });

  const errors = data.refundCreate.userErrors.map((e) => e.message);
  return {
    success: errors.length === 0,
    errors,
    data: {
      refundId: data.refundCreate.refund?.id ?? null,
      totalRefunded: data.refundCreate.refund?.totalRefundedSet.shopMoney.amount ?? null,
    },
  };
}

export async function updateShopifyOrderAddress(
  shopId: string,
  shopDomain: string,
  input: {
    orderId: string;
    shippingAddress?: { address1: string; address2?: string; city: string; province?: string; zip: string; country: string };
    note?: string;
  },
): Promise<ShopifyMutationResult> {
  const query = `
    mutation OrderUpdate($input: OrderInput!) {
      orderUpdate(input: $input) {
        order { id shippingAddress { address1 city province zip country } }
        userErrors { field message }
      }
    }
  `;

  const data = await shopifyGraphql<{
    orderUpdate: { order: { id: string } | null; userErrors: Array<{ message: string }> };
  }>(shopId, shopDomain, query, {
    input: { id: input.orderId, shippingAddress: input.shippingAddress, note: input.note ?? undefined },
  });

  const errors = data.orderUpdate.userErrors.map((e) => e.message);
  return { success: errors.length === 0, errors, data: { orderId: data.orderUpdate.order?.id ?? null } };
}

export async function issueShopifyDiscountCode(
  shopId: string,
  shopDomain: string,
  input: { code: string; title: string; valueType: "PERCENTAGE" | "FIXED_AMOUNT"; value: number; appliesOncePerCustomer: boolean },
): Promise<ShopifyMutationResult> {
  const query = `
    mutation CreateDiscountCode($basicCodeDiscount: DiscountCodeBasicInput!) {
      discountCodeBasicCreate(basicCodeDiscount: $basicCodeDiscount) {
        codeDiscountNode { id }
        userErrors { field message }
      }
    }
  `;

  const customerGetsValue =
    input.valueType === "PERCENTAGE"
      ? { percentage: input.value / 100 }
      : { discountAmount: { amount: input.value, appliesOnEachItem: false } };

  const data = await shopifyGraphql<{
    discountCodeBasicCreate: { codeDiscountNode: { id: string } | null; userErrors: Array<{ message: string }> };
  }>(shopId, shopDomain, query, {
    basicCodeDiscount: {
      title: input.title,
      code: input.code,
      startsAt: new Date().toISOString(),
      customerGets: { value: customerGetsValue, items: { all: true } },
      appliesOncePerCustomer: input.appliesOncePerCustomer,
    },
  });

  const errors = data.discountCodeBasicCreate.userErrors.map((e) => e.message);
  return { success: errors.length === 0, errors, data: { discountId: data.discountCodeBasicCreate.codeDiscountNode?.id ?? null, code: input.code } };
}

export async function createShopifyReturn(
  shopId: string,
  shopDomain: string,
  input: { orderId: string; lineItems: Array<{ fulfillmentLineItemId: string; quantity: number; reasonNote?: string }> },
): Promise<ShopifyMutationResult> {
  const query = `
    mutation ReturnCreate($returnInput: ReturnInput!) {
      returnCreate(returnInput: $returnInput) {
        return { id }
        userErrors { field message }
      }
    }
  `;

  const data = await shopifyGraphql<{
    returnCreate: { return: { id: string } | null; userErrors: Array<{ message: string }> };
  }>(shopId, shopDomain, query, {
    returnInput: {
      orderId: input.orderId,
      returnLineItems: input.lineItems.map((li) => ({
        fulfillmentLineItemId: li.fulfillmentLineItemId,
        quantity: li.quantity,
        returnReason: "OTHER",
        returnReasonNote: li.reasonNote ?? undefined,
      })),
    },
  });

  const errors = data.returnCreate.userErrors.map((e) => e.message);
  return { success: errors.length === 0, errors, data: { returnId: data.returnCreate.return?.id ?? null } };
}

export async function createShopifyReplacementDraftOrder(
  shopId: string,
  shopDomain: string,
  input: { email?: string; note?: string; lineItems: Array<{ variantId: string; quantity: number }> },
): Promise<ShopifyMutationResult> {
  const query = `
    mutation DraftOrderCreate($input: DraftOrderInput!) {
      draftOrderCreate(input: $input) {
        draftOrder { id name invoiceUrl }
        userErrors { field message }
      }
    }
  `;

  const data = await shopifyGraphql<{
    draftOrderCreate: { draftOrder: { id: string; name: string; invoiceUrl: string | null } | null; userErrors: Array<{ message: string }> };
  }>(shopId, shopDomain, query, {
    input: {
      email: input.email ?? undefined,
      note: input.note ?? "Replacement order created via AI Actions",
      tags: ["replacement-order"],
      lineItems: input.lineItems,
    },
  });

  const errors = data.draftOrderCreate.userErrors.map((e) => e.message);
  return {
    success: errors.length === 0,
    errors,
    data: {
      draftOrderId: data.draftOrderCreate.draftOrder?.id ?? null,
      draftOrderName: data.draftOrderCreate.draftOrder?.name ?? null,
      invoiceUrl: data.draftOrderCreate.draftOrder?.invoiceUrl ?? null,
    },
  };
}
