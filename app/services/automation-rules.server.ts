import db from "../db.server";
import { logAuditEvent } from "./audit.service.server";

export interface RuleCondition {
  subjectContains?: string;
  category?: string;
  priority?: string;
  customerTag?: string;
}

export interface RuleAction {
  setPriority?: string;
  assignTeamId?: string;
  assignUserId?: string;
  setStatus?: string;
}

export async function createAutomationRule({
  shopId,
  name,
  trigger = "TICKET_CREATED",
  conditions,
  actions,
}: {
  shopId: string;
  name: string;
  trigger?: string;
  conditions: RuleCondition;
  actions: RuleAction;
}) {
  return db.automationRule.create({
    data: {
      shopId,
      name: name.trim(),
      trigger,
      conditions: conditions as any,
      actions: actions as any,
      isActive: true,
    },
  });
}

export async function listAutomationRules(shopId: string) {
  return db.automationRule.findMany({
    where: { shopId },
    orderBy: { createdAt: "desc" },
  });
}

export async function executeAutomationRulesForTicket({
  shopId,
  ticketId,
  trigger = "TICKET_CREATED",
}: {
  shopId: string;
  ticketId: string;
  trigger?: string;
}) {
  const rules = await db.automationRule.findMany({
    where: { shopId, trigger, isActive: true },
  });

  if (rules.length === 0) return;

  const ticket = await db.ticket.findUnique({
    where: { id: ticketId },
    include: { customer: true },
  });

  if (!ticket) return;

  const executedRuleIds = [];
  const updateData: Record<string, any> = {};

  for (const rule of rules) {
    const cond = (rule.conditions ?? {}) as RuleCondition;
    const act = (rule.actions ?? {}) as RuleAction;

    // Condition matching
    if (cond.subjectContains && !ticket.subject.toLowerCase().includes(cond.subjectContains.toLowerCase())) {
      continue;
    }
    if (cond.priority && ticket.priority.toUpperCase() !== cond.priority.toUpperCase()) {
      continue;
    }

    // Apply Actions
    if (act.setPriority) updateData.priority = act.setPriority;
    if (act.assignTeamId) updateData.teamId = act.assignTeamId;
    if (act.assignUserId) updateData.assigneeId = act.assignUserId;
    if (act.setStatus) updateData.status = act.setStatus;

    executedRuleIds.push(rule.id);
  }

  if (Object.keys(updateData).length > 0) {
    const updatedTicket = await db.ticket.update({
      where: { id: ticketId },
      data: updateData,
    });

    await logAuditEvent({
      shopId,
      entityType: "automation_rule",
      entityId: ticketId,
      eventType: "automation.rules_executed",
      details: { executedRuleIds, updatesApplied: updateData },
      ticketId,
    });

    return updatedTicket;
  }
}
