import db from "../db.server";

export interface SLAPolicy {
  firstResponseHours: number;
  resolutionHours: number;
}

export const DEFAULT_SLA_BY_PRIORITY: Record<string, SLAPolicy> = {
  URGENT: { firstResponseHours: 1, resolutionHours: 4 },
  HIGH: { firstResponseHours: 4, resolutionHours: 24 },
  NORMAL: { firstResponseHours: 24, resolutionHours: 72 },
  LOW: { firstResponseHours: 48, resolutionHours: 168 },
};

export function calculateSLADeadlines(priority: string, createdAt: Date = new Date()) {
  const policy = DEFAULT_SLA_BY_PRIORITY[priority.toUpperCase()] || DEFAULT_SLA_BY_PRIORITY.NORMAL;
  
  const firstResponseDue = new Date(createdAt.getTime() + policy.firstResponseHours * 60 * 60 * 1000);
  const resolutionDue = new Date(createdAt.getTime() + policy.resolutionHours * 60 * 60 * 1000);

  return { firstResponseDue, resolutionDue };
}

export function evaluateSLAStatus({
  createdAt,
  firstResponseAt,
  resolvedAt,
  priority,
}: {
  createdAt: Date;
  firstResponseAt?: Date | null;
  resolvedAt?: Date | null;
  priority: string;
}): { status: "ON_TIME" | "AT_RISK" | "OVERDUE"; hoursRemaining: number } {
  const { firstResponseDue, resolutionDue } = calculateSLADeadlines(priority, createdAt);
  const now = new Date();

  const targetDue = firstResponseAt ? resolutionDue : firstResponseDue;
  const isCompleted = firstResponseAt ? Boolean(resolvedAt) : false;

  if (isCompleted) {
    return { status: "ON_TIME", hoursRemaining: 0 };
  }

  const msRemaining = targetDue.getTime() - now.getTime();
  const hoursRemaining = Math.round((msRemaining / (1000 * 60 * 60)) * 10) / 10;

  if (msRemaining < 0) {
    return { status: "OVERDUE", hoursRemaining };
  }

  if (msRemaining < 1000 * 60 * 60 * 2) {
    // Under 2 hours remaining
    return { status: "AT_RISK", hoursRemaining };
  }

  return { status: "ON_TIME", hoursRemaining };
}

export async function updateTicketSLAState(ticketId: string) {
  const ticket = await db.ticket.findUnique({ where: { id: ticketId } });
  if (!ticket) return;

  const { status } = evaluateSLAStatus({
    createdAt: ticket.createdAt,
    firstResponseAt: ticket.firstResponseAt,
    resolvedAt: ticket.resolvedAt,
    priority: ticket.priority,
  });

  return db.ticket.update({
    where: { id: ticketId },
    data: { slaStatus: status },
  });
}
