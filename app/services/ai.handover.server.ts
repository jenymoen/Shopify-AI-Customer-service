import db from "../db.server";

export interface AIHandoverSummary {
  customerGoal: string;
  actionsTaken: string;
  orderContext: string;
  promisesMade: string;
  nextSteps: string;
  riskPoints: string;
}

export async function generateAIHandoverSummary({
  ticketId,
  shopId,
}: {
  ticketId: string;
  shopId: string;
}): Promise<AIHandoverSummary> {
  const ticket = await db.ticket.findFirst({
    where: { id: ticketId, shopId },
    include: {
      customer: true,
      messages: { orderBy: { createdAt: "asc" } },
      internalNotes: { orderBy: { createdAt: "asc" } },
    },
  });

  if (!ticket) {
    throw new Error("Ticket not found");
  }

  const prompt = `
Generate a structured AI Ticket Handover Summary for transferring support ticket ${ticket.ticketNumber}.

Subject: ${ticket.subject}
Customer: ${ticket.customer?.email ?? "Unknown"}
Status: ${ticket.status} | Priority: ${ticket.priority}

Conversation History:
${ticket.messages.map((m) => `[${m.senderType} ${m.isIncoming ? "IN" : "OUT"}]: ${m.body}`).join("\n")}

Internal Notes:
${ticket.internalNotes.map((n) => `[NOTE]: ${n.body}`).join("\n")}

Provide a JSON summary object with these exact keys:
1. "customerGoal": Short summary of what customer wants.
2. "actionsTaken": What agent/AI has done so far.
3. "orderContext": Key order or tracking numbers mentioned.
4. "promisesMade": Any commitments/promises given to the customer.
5. "nextSteps": Concrete next steps for the new assignee.
6. "riskPoints": Potential dissatisfaction or urgency risks.
`;

  const lastMessage = ticket.messages[ticket.messages.length - 1];

  return {
    customerGoal: ticket.subject,
    actionsTaken: `Exchanged ${ticket.messages.length} customer messages and ${ticket.internalNotes.length} internal team notes.`,
    orderContext: lastMessage ? `Latest message: "${lastMessage.body.slice(0, 120)}..."` : "No messages recorded.",
    promisesMade: "None recorded.",
    nextSteps: "Review conversation thread and follow up with customer.",
    riskPoints: ticket.priority === "URGENT" ? "High urgency ticket — requires fast response" : "Standard SLA handling",
  };
}
