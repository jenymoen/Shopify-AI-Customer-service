import db from "../db.server";
import type { DashboardRange } from "../lib/dashboard-ranges";

const OPEN_STATUSES = ["NEW", "OPEN", "WAITING_FOR_CUSTOMER", "WAITING_FOR_AGENT"] as const;
// Statuses where the next move is ours, as opposed to waiting for the customer.
const NEEDS_REPLY_STATUSES = ["NEW", "OPEN", "WAITING_FOR_AGENT"] as const;
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_ROWS = 5000;

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function dayKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

/** All numbers on the Home dashboard. Everything is scoped to one shop and returned as plain JSON. */
export async function loadDashboard(shopId: string, rangeDays: DashboardRange) {
  const now = new Date();
  const since = new Date(now.getTime() - rangeDays * DAY_MS);
  const previousSince = new Date(now.getTime() - 2 * rangeDays * DAY_MS);
  const openWhere = { shopId, status: { in: [...OPEN_STATUSES] } };

  const [
    openCount,
    needsReplyCount,
    waitingCustomerCount,
    unassignedCount,
    highPriorityCount,
    oldestNeedingReply,
    createdPrevious,
    ticketsInRange,
    firstOutgoing,
    workloadGroups,
    pendingApprovals,
    openGaps,
    activeIncidents,
    aiExecutions,
    feedbackGroups,
    feedbackEdits,
    knowledgeDocuments,
    activeInstructions,
    shop,
    totalTickets,
  ] = await Promise.all([
    db.ticket.count({ where: openWhere }),
    db.ticket.count({ where: { shopId, status: { in: [...NEEDS_REPLY_STATUSES] } } }),
    db.ticket.count({ where: { shopId, status: "WAITING_FOR_CUSTOMER" } }),
    db.ticket.count({ where: { ...openWhere, assigneeId: null } }),
    db.ticket.count({ where: { ...openWhere, priority: { in: ["HIGH", "URGENT"] } } }),
    db.ticket.findFirst({
      where: { shopId, status: { in: [...NEEDS_REPLY_STATUSES] } },
      orderBy: { createdAt: "asc" },
      select: { createdAt: true },
    }),
    db.ticket.count({ where: { shopId, createdAt: { gte: previousSince, lt: since } } }),
    db.ticket.findMany({
      where: { shopId, OR: [{ createdAt: { gte: since } }, { resolvedAt: { gte: since } }] },
      select: { id: true, createdAt: true, resolvedAt: true, category: true, source: true },
      take: MAX_ROWS,
    }),
    // First outgoing message per ticket: works for old tickets too, unlike Ticket.firstResponseAt.
    db.ticketMessage.groupBy({
      by: ["ticketId"],
      where: { isIncoming: false, ticket: { shopId, createdAt: { gte: since } } },
      _min: { createdAt: true },
    }),
    db.ticket.groupBy({ by: ["assigneeId"], where: openWhere, _count: { _all: true } }),
    db.actionExecution.count({ where: { shopId, status: "PENDING_APPROVAL" } }),
    db.knowledgeGap.count({ where: { shopId, status: "OPEN" } }),
    db.incident.count({ where: { shopId, resolvedAt: null } }),
    db.aIExecution.findMany({
      where: { shopId, createdAt: { gte: since } },
      select: { decision: true, confidence: true, latencyMs: true, costEstimate: true },
      take: MAX_ROWS,
    }),
    db.aIFeedback.groupBy({ by: ["rating"], where: { shopId, createdAt: { gte: since } }, _count: { _all: true } }),
    db.aIFeedback.aggregate({
      where: { shopId, createdAt: { gte: since }, editDistance: { not: null } },
      _avg: { editDistance: true },
    }),
    db.knowledgeDocument.count({ where: { shopId } }),
    db.aIInstruction.count({ where: { shopId, isActive: true } }),
    db.shop.findUnique({ where: { id: shopId }, select: { supportEmail: true } }),
    db.ticket.count({ where: { shopId } }),
  ]);

  const createdInRange = ticketsInRange.filter((ticket) => ticket.createdAt >= since);
  const resolvedInRange = ticketsInRange.filter((ticket) => ticket.resolvedAt && ticket.resolvedAt >= since);

  // Daily series for the chart, oldest first, one bar per day (week buckets are not needed at 90 days).
  const days: { date: string; created: number; resolved: number }[] = [];
  const indexByDay = new Map<string, number>();
  for (let offset = rangeDays - 1; offset >= 0; offset--) {
    const key = dayKey(new Date(now.getTime() - offset * DAY_MS));
    indexByDay.set(key, days.length);
    days.push({ date: key, created: 0, resolved: 0 });
  }
  for (const ticket of createdInRange) {
    const index = indexByDay.get(dayKey(ticket.createdAt));
    if (index !== undefined) days[index].created += 1;
  }
  for (const ticket of resolvedInRange) {
    const index = indexByDay.get(dayKey(ticket.resolvedAt as Date));
    if (index !== undefined) days[index].resolved += 1;
  }

  // Response and resolution times, in milliseconds.
  const createdAtById = new Map(createdInRange.map((ticket) => [ticket.id, ticket.createdAt]));
  const firstResponseTimes: number[] = [];
  for (const group of firstOutgoing) {
    const created = createdAtById.get(group.ticketId);
    const answeredAt = group._min.createdAt;
    if (created && answeredAt && answeredAt >= created) firstResponseTimes.push(answeredAt.getTime() - created.getTime());
  }
  const resolutionTimes = resolvedInRange
    .filter((ticket) => ticket.createdAt >= since)
    .map((ticket) => (ticket.resolvedAt as Date).getTime() - ticket.createdAt.getTime())
    .filter((value) => value >= 0);

  const answeredShare = createdInRange.length > 0 ? firstResponseTimes.length / createdInRange.length : null;

  // Breakdown by category, top five.
  const categoryCounts = new Map<string, number>();
  for (const ticket of createdInRange) {
    const key = ticket.category ?? "Uncategorized";
    categoryCounts.set(key, (categoryCounts.get(key) ?? 0) + 1);
  }
  const categories = [...categoryCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([name, count]) => ({ name, count }));

  // Open tickets per assignee.
  const assigneeIds = workloadGroups.map((group) => group.assigneeId).filter((id): id is string => !!id);
  const assignees = assigneeIds.length
    ? await db.user.findMany({ where: { id: { in: assigneeIds } }, select: { id: true, name: true, email: true } })
    : [];
  const assigneeName = new Map(assignees.map((user) => [user.id, user.name ?? user.email]));
  const workload = workloadGroups
    .map((group) => ({
      name: group.assigneeId ? (assigneeName.get(group.assigneeId) ?? "Unknown") : "Unassigned",
      count: group._count._all,
    }))
    .sort((a, b) => b.count - a.count);

  // AI.
  const decisionCounts: Record<string, number> = { AUTO_SEND: 0, HUMAN_REVIEW: 0, ESCALATE: 0, NO_RESPONSE: 0 };
  for (const execution of aiExecutions) {
    if (execution.decision) decisionCounts[execution.decision] += 1;
  }
  const confidences = aiExecutions.map((execution) => execution.confidence).filter((value): value is number => value !== null);
  const latencies = aiExecutions.map((execution) => execution.latencyMs).filter((value): value is number => value !== null);
  const aiCost = aiExecutions.reduce((sum, execution) => sum + (execution.costEstimate ? Number(execution.costEstimate) : 0), 0);
  const positive = feedbackGroups.find((group) => group.rating === "POSITIVE")?._count._all ?? 0;
  const negative = feedbackGroups.find((group) => group.rating === "NEGATIVE")?._count._all ?? 0;

  return {
    rangeDays,
    generatedAt: now.toISOString(),
    attention: {
      open: openCount,
      needsReply: needsReplyCount,
      waitingCustomer: waitingCustomerCount,
      unassigned: unassignedCount,
      highPriority: highPriorityCount,
      oldestNeedingReplyMs: oldestNeedingReply ? now.getTime() - oldestNeedingReply.createdAt.getTime() : null,
      pendingApprovals,
      openGaps,
      activeIncidents,
    },
    volume: {
      created: createdInRange.length,
      createdPrevious,
      resolved: resolvedInRange.length,
      days,
      categories,
    },
    speed: {
      medianFirstResponseMs: median(firstResponseTimes),
      medianResolutionMs: median(resolutionTimes),
      answeredShare,
      resolutionSamples: resolutionTimes.length,
    },
    workload,
    ai: {
      drafts: aiExecutions.length,
      decisions: decisionCounts,
      autoSendShare: aiExecutions.length ? decisionCounts.AUTO_SEND / aiExecutions.length : null,
      avgConfidence: confidences.length ? confidences.reduce((a, b) => a + b, 0) / confidences.length : null,
      avgLatencyMs: latencies.length ? latencies.reduce((a, b) => a + b, 0) / latencies.length : null,
      cost: aiCost,
      positiveShare: positive + negative > 0 ? positive / (positive + negative) : null,
      feedbackCount: positive + negative,
      avgEditDistance: feedbackEdits._avg.editDistance,
    },
    setup: {
      supportEmail: !!shop?.supportEmail,
      knowledge: knowledgeDocuments > 0,
      instructions: activeInstructions > 0,
      firstTicket: totalTickets > 0,
    },
  };
}
