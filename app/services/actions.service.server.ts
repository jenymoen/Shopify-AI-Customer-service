// AI Actions framework (Phase 5, §20): a registry of read/write actions with schema validation,
// deterministic guardrails, per-shop policy (enable/require-approval/autopilot), human approval flow,
// idempotent execution, and full audit logging. Nothing here calls Shopify directly except through
// shopify-actions.server.ts, and nothing executes a WRITE action without passing through proposeAction().
import { randomUUID } from "node:crypto";
import { ActionCategory, ActionStatus, PermissionName, Prisma } from "@prisma/client";
import { z } from "zod";
import db from "../db.server";
import { logAuditEvent } from "./audit.service.server";
import { hasPermission } from "./authorization.server";
import { lookupShopifyCustomerByEmail } from "./shopify-context.service.server";
import { listTicketsForCustomerEmail } from "./ticket.service.server";
import {
  cancelShopifyOrder,
  createShopifyReplacementDraftOrder,
  createShopifyReturn,
  getShopifyOrderByName,
  getShopifyProductByQuery,
  issueShopifyDiscountCode,
  refundShopifyOrder,
  updateShopifyOrderAddress,
} from "./shopify-actions.server";

export interface ActionRuntimeContext {
  shopId: string;
  shopDomain: string;
}

interface GuardrailResult {
  blockers: string[];
  warnings: string[];
}

interface ActionDefinition<TInput> {
  type: string;
  category: ActionCategory;
  description: string;
  requiredPermission: PermissionName;
  inputSchema: z.ZodType<TInput>;
  guardrails?: (input: TInput, ctx: ActionRuntimeContext) => Promise<GuardrailResult>;
  execute: (input: TInput, ctx: ActionRuntimeContext) => Promise<object>;
}

const NO_GUARDRAILS: GuardrailResult = { blockers: [], warnings: [] };

function defineAction<TInput>(definition: ActionDefinition<TInput>): ActionDefinition<TInput> {
  return definition;
}

// ── Read actions (no approval ever required, but fully audited) ───────────────

const getCustomer = defineAction({
  type: "getCustomer",
  category: ActionCategory.READ,
  description: "Look up a Shopify customer by email.",
  requiredPermission: PermissionName.ACTIONS_READ,
  inputSchema: z.object({ email: z.string().email() }),
  execute: async (input, ctx) => {
    const customer = await lookupShopifyCustomerByEmail(ctx.shopId, input.email, ctx.shopDomain);
    return { customer };
  },
});

const getOrder = defineAction({
  type: "getOrder",
  category: ActionCategory.READ,
  description: "Look up a Shopify order by order name (e.g. #1001), including line items and tracking.",
  requiredPermission: PermissionName.ACTIONS_READ,
  inputSchema: z.object({ orderName: z.string().min(1) }),
  execute: async (input, ctx) => {
    const order = await getShopifyOrderByName(ctx.shopId, ctx.shopDomain, input.orderName);
    return { order };
  },
});

const getTracking = defineAction({
  type: "getTracking",
  category: ActionCategory.READ,
  description: "Get shipment tracking numbers/URLs for a Shopify order.",
  requiredPermission: PermissionName.ACTIONS_READ,
  inputSchema: z.object({ orderName: z.string().min(1) }),
  execute: async (input, ctx) => {
    const order = await getShopifyOrderByName(ctx.shopId, ctx.shopDomain, input.orderName);
    return {
      trackingNumbers: order?.trackingNumbers ?? [],
      trackingUrls: order?.trackingUrls ?? [],
      fulfillmentStatus: order?.fulfillmentStatus ?? null,
    };
  },
});

const getProduct = defineAction({
  type: "getProduct",
  category: ActionCategory.READ,
  description: "Search Shopify products by title/handle keyword.",
  requiredPermission: PermissionName.ACTIONS_READ,
  inputSchema: z.object({ query: z.string().min(1) }),
  execute: async (input, ctx) => {
    const products = await getShopifyProductByQuery(ctx.shopId, ctx.shopDomain, input.query, 5);
    return { products };
  },
});

const getRelevantTickets = defineAction({
  type: "getRelevantTickets",
  category: ActionCategory.READ,
  description: "List a customer's other support tickets in this shop.",
  requiredPermission: PermissionName.ACTIONS_READ,
  inputSchema: z.object({ email: z.string().email() }),
  execute: async (input, ctx) => {
    const tickets = await listTicketsForCustomerEmail(ctx.shopId, input.email, 10);
    return { tickets };
  },
});

// ── Write actions (subject to policy, guardrails, and approval) ───────────────

const cancelOrder = defineAction({
  type: "cancelOrder",
  category: ActionCategory.WRITE,
  description: "Cancel a Shopify order.",
  requiredPermission: PermissionName.ACTIONS_WRITE,
  inputSchema: z.object({
    orderName: z.string().min(1),
    reason: z.enum(["CUSTOMER", "DECLINED", "FRAUD", "INVENTORY", "STAFF", "OTHER"]).default("CUSTOMER"),
    notifyCustomer: z.boolean().default(true),
    restock: z.boolean().default(true),
    refundToOriginal: z.boolean().default(true),
    staffNote: z.string().max(255).optional(),
  }),
  guardrails: async (input, ctx) => {
    const order = await getShopifyOrderByName(ctx.shopId, ctx.shopDomain, input.orderName);
    if (!order) return { blockers: [`Order ${input.orderName} was not found.`], warnings: [] };
    if (order.cancelledAt) return { blockers: [`Order ${input.orderName} is already cancelled.`], warnings: [] };
    return NO_GUARDRAILS;
  },
  execute: async (input, ctx) => {
    const order = await getShopifyOrderByName(ctx.shopId, ctx.shopDomain, input.orderName);
    if (!order) throw new Error(`Order ${input.orderName} was not found.`);
    return cancelShopifyOrder(ctx.shopId, ctx.shopDomain, { orderId: order.id, ...input });
  },
});

const refundOrder = defineAction({
  type: "refundOrder",
  category: ActionCategory.WRITE,
  description: "Refund one or more line items on a Shopify order.",
  requiredPermission: PermissionName.ACTIONS_WRITE,
  inputSchema: z.object({
    orderName: z.string().min(1),
    lineItems: z.array(z.object({ lineItemId: z.string().min(1), quantity: z.number().int().positive() })).min(1),
    note: z.string().max(500).optional(),
    notifyCustomer: z.boolean().default(true),
  }),
  guardrails: async (input, ctx) => {
    const order = await getShopifyOrderByName(ctx.shopId, ctx.shopDomain, input.orderName);
    if (!order) return { blockers: [`Order ${input.orderName} was not found.`], warnings: [] };
    if (order.financialStatus === "REFUNDED") {
      return { blockers: [`Order ${input.orderName} is already fully refunded.`], warnings: [] };
    }
    const validIds = new Set(order.lineItems.map((li) => li.id));
    const unknown = input.lineItems.filter((li) => !validIds.has(li.lineItemId));
    if (unknown.length > 0) {
      return { blockers: [`Line item(s) not found on order ${input.orderName}.`], warnings: [] };
    }
    return NO_GUARDRAILS;
  },
  execute: async (input, ctx) => {
    const order = await getShopifyOrderByName(ctx.shopId, ctx.shopDomain, input.orderName);
    if (!order) throw new Error(`Order ${input.orderName} was not found.`);
    return refundShopifyOrder(ctx.shopId, ctx.shopDomain, {
      orderId: order.id,
      idempotencyKey: randomUUID(),
      lineItems: input.lineItems,
      note: input.note,
      notifyCustomer: input.notifyCustomer,
    });
  },
});

const changeAddress = defineAction({
  type: "changeAddress",
  category: ActionCategory.WRITE,
  description: "Update the shipping address on a Shopify order (before fulfillment).",
  requiredPermission: PermissionName.ACTIONS_WRITE,
  inputSchema: z.object({
    orderName: z.string().min(1),
    shippingAddress: z.object({
      address1: z.string().min(1),
      address2: z.string().optional(),
      city: z.string().min(1),
      province: z.string().optional(),
      zip: z.string().min(1),
      country: z.string().min(1),
    }),
  }),
  guardrails: async (input, ctx) => {
    const order = await getShopifyOrderByName(ctx.shopId, ctx.shopDomain, input.orderName);
    if (!order) return { blockers: [`Order ${input.orderName} was not found.`], warnings: [] };
    if (order.fulfillmentStatus === "FULFILLED") {
      return { blockers: [`Order ${input.orderName} is already fulfilled; address changes are no longer possible.`], warnings: [] };
    }
    return NO_GUARDRAILS;
  },
  execute: async (input, ctx) => {
    const order = await getShopifyOrderByName(ctx.shopId, ctx.shopDomain, input.orderName);
    if (!order) throw new Error(`Order ${input.orderName} was not found.`);
    return updateShopifyOrderAddress(ctx.shopId, ctx.shopDomain, { orderId: order.id, shippingAddress: input.shippingAddress });
  },
});

const editOrder = defineAction({
  type: "editOrder",
  category: ActionCategory.WRITE,
  description: "Update order-level note (e.g. gift wrap instructions, delivery notes).",
  requiredPermission: PermissionName.ACTIONS_WRITE,
  inputSchema: z.object({ orderName: z.string().min(1), note: z.string().max(1000) }),
  guardrails: async (input, ctx) => {
    const order = await getShopifyOrderByName(ctx.shopId, ctx.shopDomain, input.orderName);
    if (!order) return { blockers: [`Order ${input.orderName} was not found.`], warnings: [] };
    return NO_GUARDRAILS;
  },
  execute: async (input, ctx) => {
    const order = await getShopifyOrderByName(ctx.shopId, ctx.shopDomain, input.orderName);
    if (!order) throw new Error(`Order ${input.orderName} was not found.`);
    return updateShopifyOrderAddress(ctx.shopId, ctx.shopDomain, { orderId: order.id, note: input.note });
  },
});

const MAX_DISCOUNT_PERCENTAGE_WITHOUT_OVERRIDE = 50;

const issueDiscount = defineAction({
  type: "issueDiscount",
  category: ActionCategory.WRITE,
  description: "Issue a one-time discount code for a customer (goodwill gesture, service recovery).",
  requiredPermission: PermissionName.ACTIONS_WRITE,
  inputSchema: z.object({
    code: z.string().min(3).max(40),
    title: z.string().min(1).max(120),
    valueType: z.enum(["PERCENTAGE", "FIXED_AMOUNT"]),
    value: z.number().positive(),
    appliesOncePerCustomer: z.boolean().default(true),
  }),
  guardrails: async (input) => {
    const warnings: string[] = [];
    const blockers: string[] = [];
    if (input.valueType === "PERCENTAGE" && input.value > MAX_DISCOUNT_PERCENTAGE_WITHOUT_OVERRIDE) {
      blockers.push(`Percentage discount of ${input.value}% exceeds the ${MAX_DISCOUNT_PERCENTAGE_WITHOUT_OVERRIDE}% guardrail.`);
    }
    if (input.valueType === "PERCENTAGE" && input.value >= 25) {
      warnings.push(`Discount of ${input.value}% is unusually high for a service-recovery gesture.`);
    }
    return { blockers, warnings };
  },
  execute: async (input, ctx) => issueShopifyDiscountCode(ctx.shopId, ctx.shopDomain, input),
});

const createReturn = defineAction({
  type: "createReturn",
  category: ActionCategory.WRITE,
  description: "Create a return for fulfilled line items on a Shopify order.",
  requiredPermission: PermissionName.ACTIONS_WRITE,
  inputSchema: z.object({
    orderName: z.string().min(1),
    lineItems: z.array(z.object({ lineItemId: z.string().min(1), quantity: z.number().int().positive(), reasonNote: z.string().max(500).optional() })).min(1),
  }),
  guardrails: async (input, ctx) => {
    const order = await getShopifyOrderByName(ctx.shopId, ctx.shopDomain, input.orderName);
    if (!order) return { blockers: [`Order ${input.orderName} was not found.`], warnings: [] };
    const lineItemsById = new Map(order.lineItems.map((li) => [li.id, li]));
    const blockers: string[] = [];
    for (const requested of input.lineItems) {
      const match = lineItemsById.get(requested.lineItemId);
      if (!match) blockers.push(`Line item ${requested.lineItemId} not found on order ${input.orderName}.`);
      else if (!match.fulfillmentLineItemId) blockers.push(`Line item "${match.title}" has not been fulfilled yet and cannot be returned.`);
    }
    return { blockers, warnings: [] };
  },
  execute: async (input, ctx) => {
    const order = await getShopifyOrderByName(ctx.shopId, ctx.shopDomain, input.orderName);
    if (!order) throw new Error(`Order ${input.orderName} was not found.`);
    const lineItemsById = new Map(order.lineItems.map((li) => [li.id, li]));
    return createShopifyReturn(ctx.shopId, ctx.shopDomain, {
      orderId: order.id,
      lineItems: input.lineItems.map((li) => ({
        fulfillmentLineItemId: lineItemsById.get(li.lineItemId)!.fulfillmentLineItemId!,
        quantity: li.quantity,
        reasonNote: li.reasonNote,
      })),
    });
  },
});

const createReplacementOrder = defineAction({
  type: "createReplacementOrder",
  category: ActionCategory.WRITE,
  description: "Create a draft replacement order for a customer (e.g. for a damaged/lost item).",
  requiredPermission: PermissionName.ACTIONS_WRITE,
  inputSchema: z.object({
    email: z.string().email().optional(),
    note: z.string().max(500).optional(),
    lineItems: z.array(z.object({ variantId: z.string().min(1), quantity: z.number().int().positive() })).min(1),
  }),
  execute: async (input, ctx) => createShopifyReplacementDraftOrder(ctx.shopId, ctx.shopDomain, input),
});

const ACTION_REGISTRY: Record<string, ActionDefinition<any>> = {
  getCustomer,
  getOrder,
  getTracking,
  getProduct,
  getRelevantTickets,
  cancelOrder,
  refundOrder,
  changeAddress,
  editOrder,
  issueDiscount,
  createReturn,
  createReplacementOrder,
};

export function getActionRegistry() {
  return Object.values(ACTION_REGISTRY).map((d) => ({
    type: d.type,
    category: d.category,
    description: d.description,
  }));
}

// ── Per-shop action policy ─────────────────────────────────────────────────────

const DEFAULT_REQUIRES_APPROVAL: Record<string, boolean> = {
  getCustomer: false,
  getOrder: false,
  getTracking: false,
  getProduct: false,
  getRelevantTickets: false,
  cancelOrder: true,
  refundOrder: true,
  changeAddress: true,
  editOrder: true,
  issueDiscount: true,
  createReturn: true,
  createReplacementOrder: true,
};

export async function getOrCreateActionPolicy(shopId: string, actionType: string) {
  const existing = await db.actionPolicy.findUnique({ where: { shopId_actionType: { shopId, actionType } } });
  if (existing) return existing;

  const definition = ACTION_REGISTRY[actionType];
  const requiresApproval = DEFAULT_REQUIRES_APPROVAL[actionType] ?? definition?.category === ActionCategory.WRITE;

  return db.actionPolicy.create({
    data: { shopId, actionType, isEnabled: true, requiresApproval, autopilotEnabled: false },
  });
}

export async function listActionPolicies(shopId: string) {
  const existing = await db.actionPolicy.findMany({ where: { shopId } });
  const existingTypes = new Set(existing.map((p) => p.actionType));
  const missing = Object.keys(ACTION_REGISTRY).filter((type) => !existingTypes.has(type));
  const created = await Promise.all(missing.map((type) => getOrCreateActionPolicy(shopId, type)));

  return [...existing, ...created]
    .map((policy) => ({ ...policy, description: ACTION_REGISTRY[policy.actionType]?.description ?? "", category: ACTION_REGISTRY[policy.actionType]?.category ?? ActionCategory.WRITE }))
    .sort((a, b) => a.actionType.localeCompare(b.actionType));
}

export async function updateActionPolicy({
  shopId,
  actionType,
  isEnabled,
  requiresApproval,
  autopilotEnabled,
}: {
  shopId: string;
  actionType: string;
  isEnabled: boolean;
  requiresApproval: boolean;
  autopilotEnabled: boolean;
}) {
  return db.actionPolicy.upsert({
    where: { shopId_actionType: { shopId, actionType } },
    update: { isEnabled, requiresApproval, autopilotEnabled },
    create: { shopId, actionType, isEnabled, requiresApproval, autopilotEnabled },
  });
}

// ── Propose / approve / reject / execute ───────────────────────────────────────

export interface ProposeActionInput {
  shopId: string;
  shopDomain: string;
  actionType: string;
  input: unknown;
  ticketId?: string | null;
  requestedByUserId?: string | null;
  requestedByAiExecutionId?: string | null;
  idempotencyKey?: string;
}

export async function proposeAction(params: ProposeActionInput) {
  const { shopId, shopDomain, actionType, ticketId, requestedByUserId, requestedByAiExecutionId } = params;
  const definition = ACTION_REGISTRY[actionType];
  if (!definition) throw new Error(`Unknown action type: ${actionType}`);

  if (requestedByUserId) {
    const allowed = await hasPermission({ userId: requestedByUserId, shopId, permission: definition.requiredPermission });
    if (!allowed) throw new Error(`Forbidden: user lacks ${definition.requiredPermission} permission.`);
  }

  const parsed = definition.inputSchema.safeParse(params.input);
  if (!parsed.success) {
    throw new Error(`Invalid input for action "${actionType}": ${parsed.error.issues.map((i) => i.message).join("; ")}`);
  }

  const idempotencyKey = params.idempotencyKey ?? randomUUID();

  const existing = await db.actionExecution.findUnique({
    where: { shopId_idempotencyKey: { shopId, idempotencyKey } },
  });
  if (existing) return existing;

  const policy = await getOrCreateActionPolicy(shopId, actionType);

  if (!policy.isEnabled) {
    const execution = await db.actionExecution.create({
      data: {
        shopId,
        ticketId: ticketId ?? null,
        actionType,
        category: definition.category,
        status: ActionStatus.FAILED,
        idempotencyKey,
        input: parsed.data as Prisma.InputJsonValue,
        errorMessage: "This action type is disabled for this shop.",
        requestedByUserId: requestedByUserId ?? null,
        requestedByAiExecutionId: requestedByAiExecutionId ?? null,
      },
    });
    await logAuditEvent({
      shopId,
      actorUserId: requestedByUserId,
      entityType: "action",
      entityId: execution.id,
      eventType: "action.rejected_disabled",
      ticketId,
    });
    return execution;
  }

  const guardrails = definition.guardrails ? await definition.guardrails(parsed.data, { shopId, shopDomain }) : NO_GUARDRAILS;

  if (guardrails.blockers.length > 0) {
    const execution = await db.actionExecution.create({
      data: {
        shopId,
        ticketId: ticketId ?? null,
        actionType,
        category: definition.category,
        status: ActionStatus.FAILED,
        idempotencyKey,
        input: parsed.data as Prisma.InputJsonValue,
        guardrailResults: guardrails as unknown as Prisma.InputJsonValue,
        errorMessage: `Guardrail check failed: ${guardrails.blockers.join("; ")}`,
        requestedByUserId: requestedByUserId ?? null,
        requestedByAiExecutionId: requestedByAiExecutionId ?? null,
      },
    });
    await logAuditEvent({
      shopId,
      actorUserId: requestedByUserId,
      entityType: "action",
      entityId: execution.id,
      eventType: "action.guardrail_blocked",
      details: { actionType, blockers: guardrails.blockers },
      ticketId,
    });
    return execution;
  }

  const needsApproval = definition.category === ActionCategory.WRITE && policy.requiresApproval && !policy.autopilotEnabled;

  const execution = await db.actionExecution.create({
    data: {
      shopId,
      ticketId: ticketId ?? null,
      actionType,
      category: definition.category,
      status: needsApproval ? ActionStatus.PENDING_APPROVAL : ActionStatus.PROPOSED,
      idempotencyKey,
      input: parsed.data as Prisma.InputJsonValue,
      guardrailResults: guardrails as unknown as Prisma.InputJsonValue,
      requestedByUserId: requestedByUserId ?? null,
      requestedByAiExecutionId: requestedByAiExecutionId ?? null,
    },
  });

  await logAuditEvent({
    shopId,
    actorUserId: requestedByUserId,
    entityType: "action",
    entityId: execution.id,
    eventType: needsApproval ? "action.proposed_pending_approval" : "action.proposed",
    details: { actionType, category: definition.category, warnings: guardrails.warnings },
    ticketId,
  });

  if (needsApproval) return execution;

  return executeAction({ actionExecutionId: execution.id, shopId, shopDomain, executedByUserId: requestedByUserId });
}

export async function executeAction({
  actionExecutionId,
  shopId,
  shopDomain,
  executedByUserId,
}: {
  actionExecutionId: string;
  shopId: string;
  shopDomain: string;
  executedByUserId?: string | null;
}) {
  const execution = await db.actionExecution.findFirst({ where: { id: actionExecutionId, shopId } });
  if (!execution) throw new Error("Action execution not found.");
  if (execution.status === ActionStatus.SUCCEEDED) return execution;
  if (execution.status !== ActionStatus.PROPOSED && execution.status !== ActionStatus.APPROVED) {
    throw new Error(`Action cannot be executed from status ${execution.status}.`);
  }

  const definition = ACTION_REGISTRY[execution.actionType];
  if (!definition) throw new Error(`Unknown action type: ${execution.actionType}`);

  await db.actionExecution.update({ where: { id: execution.id }, data: { status: ActionStatus.EXECUTING } });

  try {
    const result = await definition.execute(execution.input, { shopId, shopDomain });
    const updated = await db.actionExecution.update({
      where: { id: execution.id },
      data: { status: ActionStatus.SUCCEEDED, result: result as Prisma.InputJsonValue, executedAt: new Date() },
    });
    await logAuditEvent({
      shopId,
      actorUserId: executedByUserId,
      entityType: "action",
      entityId: execution.id,
      eventType: "action.executed",
      details: { actionType: execution.actionType, result },
      ticketId: execution.ticketId,
    });
    return updated;
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    const updated = await db.actionExecution.update({
      where: { id: execution.id },
      data: { status: ActionStatus.FAILED, errorMessage: message, executedAt: new Date() },
    });
    await logAuditEvent({
      shopId,
      actorUserId: executedByUserId,
      entityType: "action",
      entityId: execution.id,
      eventType: "action.execution_failed",
      details: { actionType: execution.actionType, error: message },
      ticketId: execution.ticketId,
    });
    return updated;
  }
}

export async function approveAction({
  actionExecutionId,
  shopId,
  shopDomain,
  approverUserId,
}: {
  actionExecutionId: string;
  shopId: string;
  shopDomain: string;
  approverUserId: string;
}) {
  const allowed = await hasPermission({ userId: approverUserId, shopId, permission: PermissionName.ACTIONS_APPROVE });
  if (!allowed) throw new Error("Forbidden: missing ACTIONS_APPROVE permission.");

  const execution = await db.actionExecution.findFirst({ where: { id: actionExecutionId, shopId } });
  if (!execution) throw new Error("Action execution not found.");
  if (execution.status !== ActionStatus.PENDING_APPROVAL) {
    throw new Error(`Action is not pending approval (status: ${execution.status}).`);
  }

  await db.actionExecution.update({
    where: { id: execution.id },
    data: { status: ActionStatus.APPROVED, approvedByUserId: approverUserId, approvedAt: new Date() },
  });

  await logAuditEvent({
    shopId,
    actorUserId: approverUserId,
    entityType: "action",
    entityId: execution.id,
    eventType: "action.approved",
    ticketId: execution.ticketId,
  });

  return executeAction({ actionExecutionId: execution.id, shopId, shopDomain, executedByUserId: approverUserId });
}

export async function rejectAction({
  actionExecutionId,
  shopId,
  rejecterUserId,
  reason,
}: {
  actionExecutionId: string;
  shopId: string;
  rejecterUserId: string;
  reason?: string;
}) {
  const allowed = await hasPermission({ userId: rejecterUserId, shopId, permission: PermissionName.ACTIONS_APPROVE });
  if (!allowed) throw new Error("Forbidden: missing ACTIONS_APPROVE permission.");

  const execution = await db.actionExecution.findFirst({ where: { id: actionExecutionId, shopId } });
  if (!execution) throw new Error("Action execution not found.");
  if (execution.status !== ActionStatus.PENDING_APPROVAL) {
    throw new Error(`Action is not pending approval (status: ${execution.status}).`);
  }

  const updated = await db.actionExecution.update({
    where: { id: execution.id },
    data: { status: ActionStatus.REJECTED, rejectedByUserId: rejecterUserId, rejectedAt: new Date(), errorMessage: reason ?? null },
  });

  await logAuditEvent({
    shopId,
    actorUserId: rejecterUserId,
    entityType: "action",
    entityId: execution.id,
    eventType: "action.rejected",
    details: { reason },
    ticketId: execution.ticketId,
  });

  return updated;
}

// ── Listing ─────────────────────────────────────────────────────────────────

export async function listPendingActions(shopId: string) {
  return db.actionExecution.findMany({
    where: { shopId, status: ActionStatus.PENDING_APPROVAL },
    orderBy: { createdAt: "asc" },
    include: { ticket: { select: { id: true, ticketNumber: true, subject: true } } },
  });
}

export async function listActionHistory(shopId: string, options?: { ticketId?: string; limit?: number }) {
  return db.actionExecution.findMany({
    where: { shopId, ...(options?.ticketId ? { ticketId: options.ticketId } : {}) },
    orderBy: { createdAt: "desc" },
    take: options?.limit ?? 50,
    include: { ticket: { select: { id: true, ticketNumber: true, subject: true } } },
  });
}
