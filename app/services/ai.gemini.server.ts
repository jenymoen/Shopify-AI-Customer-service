import { GoogleGenAI } from "@google/genai";

let _client: GoogleGenAI | null = null;

export function getGeminiClient(): GoogleGenAI {
  if (!_client) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error("GEMINI_API_KEY is not set in environment variables.");
    _client = new GoogleGenAI({ apiKey });
  }
  return _client;
}

export const DEFAULT_GEMINI_MODEL = "gemini-3.6-flash";

// Overload (503), rate limit (429) and internal errors (500) are usually temporary.
const RETRYABLE_STATUSES = new Set([429, 500, 503]);
const RETRY_DELAYS_MS = [1000, 3000];

export function isRetryableGeminiError(error: unknown) {
  const status = (error as { status?: unknown } | null)?.status;
  return typeof status === "number" && RETRYABLE_STATUSES.has(status);
}

async function generateContent(prompt: string) {
  const client = getGeminiClient();
  for (let attempt = 0; ; attempt++) {
    try {
      return await client.models.generateContent({ model: DEFAULT_GEMINI_MODEL, contents: prompt });
    } catch (error) {
      if (attempt >= RETRY_DELAYS_MS.length || !isRetryableGeminiError(error)) throw error;
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAYS_MS[attempt]));
    }
  }
}

/**
 * Free-form text generation, used by the ticket reply orchestrator.
 */
export async function generateText(prompt: string): Promise<string | null> {
  const result = await generateContent(prompt);
  return result.text?.trim() || null;
}

/**
 * Classify a customer support query using Gemini.
 */
export async function classifyCustomerQuery(query: string): Promise<{
  category: string;
  confidence: number;
  reasoning: string;
}> {
  const prompt = `You are a customer support triage classifier. Classify the customer's message into exactly one category.

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

Respond with ONLY valid JSON in this exact format (no markdown, no code block):
{"category": "CATEGORY_NAME", "confidence": 0.95, "reasoning": "one sentence"}

Customer message:
${query}`;

  const result = await generateContent(prompt);

  const text = result.text ?? "{}";
  // Strip markdown code fences if present
  const clean = text.replace(/```json?\n?/g, "").replace(/```/g, "").trim();

  try {
    const parsed = JSON.parse(clean);
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
 * Generate a grounded customer support response using Gemini.
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
  const knowledgeContext =
    knowledgeChunks.length > 0
      ? knowledgeChunks.map((c, i) => `[Source ${i + 1}: ${c.title}]\n${c.content}`).join("\n\n")
      : "No specific knowledge articles available for this query.";

  const prompt = `You are a friendly and professional customer support agent for ${shopName}.

RULES:
1. Answer ONLY based on the provided knowledge sources. Do not invent policies or facts.
2. If the knowledge sources don't cover the customer's issue, say so honestly and offer to escalate to a human agent.
3. Be empathetic, concise, and helpful. Use the customer's language (respond in Norwegian if they write in Norwegian).
4. Do NOT include salutations like "Dear Customer" — start directly with the answer.
5. End with a brief offer to help further.

KNOWLEDGE SOURCES:
${knowledgeContext}

Customer issue (category: ${category}):
${customerQuery}`;

  const result = await generateContent(prompt);

  const text = result.text ?? "";
  const isGrounded = knowledgeChunks.length > 0;

  return {
    response: text,
    isGrounded,
    hasUnsupportedClaims: !isGrounded,
  };
}

/**
 * Generate a handover summary for a ticket using Gemini.
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
  const conversation = messages
    .slice(-10)
    .map((m) => `[${m.senderType}]: ${m.body}`)
    .join("\n");

  const prompt = `You are a support agent writing a brief internal handover note for a colleague taking over a ticket.
Be concise (3-5 bullet points). Include: issue summary, what has been tried, current status, recommended next step.

Ticket: "${ticketSubject}"
Customer: ${customerName}

Conversation:
${conversation}`;

  const result = await generateContent(prompt);

  return result.text ?? "Unable to generate summary.";
}
