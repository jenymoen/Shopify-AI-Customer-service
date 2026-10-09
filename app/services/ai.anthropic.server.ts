import Anthropic from "@anthropic-ai/sdk";

let _client: Anthropic | null = null;

export function getAnthropicClient(): Anthropic {
  if (!_client) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error("ANTHROPIC_API_KEY is not set in environment variables.");
    }
    _client = new Anthropic({ apiKey });
  }
  return _client;
}

export const DEFAULT_MODEL = "claude-sonnet-4-5";

/**
 * Classify a customer support query into a category with confidence.
 */
export async function classifyCustomerQuery(query: string): Promise<{
  category: string;
  confidence: number;
  reasoning: string;
}> {
  const client = getAnthropicClient();

  const response = await client.messages.create({
    model: DEFAULT_MODEL,
    max_tokens: 256,
    system: `You are a customer support triage classifier. Classify the customer's message into exactly one category.

Categories (pick the most specific):
- ACCOUNT_ACCESS (login issues, password reset, account locked, can't access account)
- ORDER_STATUS (order tracking, delivery updates, where is my order)
- RETURNS (return requests, return policy questions, how to return)
- REFUNDS (refund status, refund requests, money back)
- SHIPPING (shipping times, shipping options, delivery address changes)
- PRODUCT_INFO (product questions, compatibility, specifications)
- BILLING (payment issues, invoice questions, charges)
- CANCELLATION (cancel order, cancel subscription)
- TECHNICAL (app/website bugs, technical errors)
- COMPLAINT (complaints about service or product quality)
- GENERAL (anything that doesn't fit the above)

Respond with ONLY valid JSON in this exact format:
{"category": "CATEGORY_NAME", "confidence": 0.95, "reasoning": "one sentence"}`,
    messages: [{ role: "user", content: query }],
  });

  try {
    const text = response.content[0].type === "text" ? response.content[0].text : "{}";
    const parsed = JSON.parse(text);
    return {
      category: parsed.category ?? "GENERAL",
      confidence: Math.min(1, Math.max(0, parsed.confidence ?? 0.7)),
      reasoning: parsed.reasoning ?? "",
    };
  } catch {
    return { category: "GENERAL", confidence: 0.65, reasoning: "Classification parse error" };
  }
}

/**
 * Generate a grounded customer support response using retrieved knowledge chunks.
 */
export async function generateSupportResponse({
  customerQuery,
  knowledgeChunks,
  shopName,
  category,
}: {
  customerQuery: string;
  knowledgeChunks: Array<{ title: string; content: string }>;
  shopName: string;
  category: string;
}): Promise<{ response: string; isGrounded: boolean; hasUnsupportedClaims: boolean }> {
  const client = getAnthropicClient();

  const knowledgeContext =
    knowledgeChunks.length > 0
      ? knowledgeChunks
          .map((c, i) => `[Source ${i + 1}: ${c.title}]\n${c.content}`)
          .join("\n\n")
      : "No specific knowledge articles available for this query.";

  const response = await client.messages.create({
    model: DEFAULT_MODEL,
    max_tokens: 512,
    system: `You are a friendly and professional customer support agent for ${shopName}.

RULES:
1. Answer ONLY based on the provided knowledge sources. Do not invent policies or facts.
2. If the knowledge sources don't cover the customer's issue, say so honestly and offer to escalate to a human agent.
3. Be empathetic, concise, and helpful. Use the customer's language if they write in a non-English language.
4. Do NOT include salutations like "Dear Customer" — start directly with the answer.
5. End with a brief offer to help further.

KNOWLEDGE SOURCES:
${knowledgeContext}`,
    messages: [{ role: "user", content: `Customer issue (category: ${category}):\n\n${customerQuery}` }],
  });

  const text = response.content[0].type === "text" ? response.content[0].text : "";
  const isGrounded = knowledgeChunks.length > 0;

  return {
    response: text,
    isGrounded,
    hasUnsupportedClaims: !isGrounded,
  };
}

/**
 * Generate an AI handover summary for a ticket being transferred between agents.
 */
export async function generateHandoverSummary({
  ticketSubject,
  messages,
  customerName,
}: {
  ticketSubject: string;
  messages: Array<{ body: string; senderType: string; createdAt: Date }>;
  customerName: string;
}): Promise<string> {
  const client = getAnthropicClient();

  const conversation = messages
    .slice(-10)
    .map((m) => `[${m.senderType}]: ${m.body}`)
    .join("\n");

  const response = await client.messages.create({
    model: DEFAULT_MODEL,
    max_tokens: 300,
    system: `You are a support agent writing a brief internal handover note for a colleague taking over a ticket. 
Be concise (3-5 bullet points). Include: issue summary, what has been tried, current status, recommended next step.`,
    messages: [
      {
        role: "user",
        content: `Ticket: "${ticketSubject}"\nCustomer: ${customerName}\n\nConversation:\n${conversation}`,
      },
    ],
  });

  return response.content[0].type === "text" ? response.content[0].text : "Unable to generate summary.";
}
