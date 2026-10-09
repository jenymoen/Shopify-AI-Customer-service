import db from "../db.server";
import { AIExecutionDecision } from "@prisma/client";
import { appConfig } from "../lib/config.server";
import { getActiveAiInstructionsForShop, searchKnowledgeForTicket } from "./knowledge.service.server";
import { generateText as generateGeminiText } from "./ai.gemini.server";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface TicketClassification {
  category: string;
  priority: string;
  sentiment: string;
  urgency: string;
  requiresHuman: boolean;
  language: string;
  confidence: number;
  requestedActions: string[];
}

export interface OrchestratorContext {
  activeInstructions: Array<{ name: string; type: string; content: string }>;
  knowledgeMatches: Array<{ title: string; content: string; sourceType: string; score: number }>;
}

export interface CandidateReply {
  text: string;
  sourceReferences: string[];
  model: string;
}

export interface ValidationResult {
  isGrounded: boolean;
  hasUnsupportedClaims: boolean;
  answersQuestion: boolean;
  requiresHuman: boolean;
  warnings: string[];
}

export interface OrchestratorResult {
  classification: TicketClassification;
  context: OrchestratorContext;
  candidate: CandidateReply;
  validation: ValidationResult;
  decision: AIExecutionDecision;
  aiExecutionId: string;
}

// ── Classification ────────────────────────────────────────────────────────────

function classifyFromText(subject: string, body: string): TicketClassification {
  const text = `${subject} ${body}`.toLowerCase();

  // Simple heuristic classification (real impl would call AI API)
  let category = "GENERAL";
  if (/return|refund|exchange/i.test(text)) category = "RETURNS";
  else if (/ship|delivery|track|transit|carrier/i.test(text)) category = "SHIPPING";
  else if (/order|purchase|buy|bought/i.test(text)) category = "ORDER";
  else if (/product|item|quality|broken|defect/i.test(text)) category = "PRODUCT";
  else if (/cancel|void|undo/i.test(text)) category = "CANCELLATION";
  else if (/complain|angry|upset|terrible|horrible|worst/i.test(text)) category = "COMPLAINT";

  let sentiment = "NEUTRAL";
  if (/angry|furious|upset|terrible|horrible|awful|worst|disgusting/i.test(text)) sentiment = "NEGATIVE";
  else if (/thank|great|excellent|amazing|wonderful|love|perfect/i.test(text)) sentiment = "POSITIVE";

  let urgency = "NORMAL";
  if (/urgent|asap|immediately|emergency|critical|deadline/i.test(text)) urgency = "HIGH";

  const requiresHuman =
    /speak.*manager|supervisor|legal|lawsuit|attorney|escalat/i.test(text) ||
    sentiment === "NEGATIVE";

  const language = detectLanguage(text);

  return {
    category,
    priority: urgency === "HIGH" || sentiment === "NEGATIVE" ? "HIGH" : "NORMAL",
    sentiment,
    urgency,
    requiresHuman,
    language,
    confidence: 0.72,
    requestedActions: [],
  };
}

// Norwegian if the text has æ/ø/å or at least two common Norwegian words.
const NORWEGIAN_WORDS =
  /\b(hei|takk|jeg|ikke|dere|har|med|til|som|det|er|min|mitt|vennligst|bestilling|ordre|ordrenummer|retur|leveranse|ønsker|hjelp|klokken|svar)\b/gi;

function detectLanguage(text: string): "no" | "en" {
  if (/[æøåÆØÅ]/.test(text)) return "no";
  return (text.match(NORWEGIAN_WORDS)?.length ?? 0) >= 2 ? "no" : "en";
}

// ── Context retrieval ─────────────────────────────────────────────────────────

async function retrieveContext(shopId: string, query: string): Promise<OrchestratorContext> {
  const [activeInstructions, knowledgeMatches] = await Promise.all([
    getActiveAiInstructionsForShop(shopId),
    searchKnowledgeForTicket({ shopId, query, limit: 4 }),
  ]);

  return {
    activeInstructions: activeInstructions.map((i) => ({
      name: i.name,
      type: i.type,
      content: i.content,
    })),
    knowledgeMatches: knowledgeMatches.map((m) => ({
      title: m.title,
      content: m.content,
      sourceType: m.sourceType,
      score: m.score,
    })),
  };
}

// ── AI provider call ──────────────────────────────────────────────────────────

async function callAIProvider(prompt: string): Promise<{ text: string; provider: string } | null> {
  // Gemini first when configured (same preference as the AI test center).
  if (process.env.GEMINI_API_KEY) {
    try {
      const text = await generateGeminiText(prompt);
      if (text) return { text, provider: "gemini" };
    } catch (err) {
      console.error("[ai] Gemini call failed:", err);
    }
  }

  if (!appConfig.AI_API_KEY) {
    // Return null so the local fallback is used
    return null;
  }

  if (appConfig.AI_PROVIDER === "anthropic") {
    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "x-api-key": appConfig.AI_API_KEY,
          "anthropic-version": "2023-06-01",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "claude-opus-4-5",
          max_tokens: 1024,
          messages: [{ role: "user", content: prompt }],
        }),
      });

      if (!res.ok) {
        console.error("[ai] Anthropic API error:", res.status, await res.text());
        return null;
      }

      const json = (await res.json()) as {
        content?: Array<{ type: string; text: string }>;
      };
      const text = json.content?.find((c) => c.type === "text")?.text;
      return text ? { text, provider: "anthropic" } : null;
    } catch (err) {
      console.error("[ai] Anthropic call failed:", err);
      return null;
    }
  }

  if (appConfig.AI_PROVIDER === "openai") {
    try {
      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${appConfig.AI_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "gpt-4o",
          max_tokens: 1024,
          messages: [{ role: "user", content: prompt }],
        }),
      });

      if (!res.ok) {
        console.error("[ai] OpenAI API error:", res.status, await res.text());
        return null;
      }

      const json = (await res.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
      };
      const text = json.choices?.[0]?.message?.content;
      return text ? { text, provider: "openai" } : null;
    } catch (err) {
      console.error("[ai] OpenAI call failed:", err);
      return null;
    }
  }

  return null;
}

// ── Candidate reply generation ────────────────────────────────────────────────

async function generateCandidateReply(
  ticket: {
    subject: string;
    customer?: { firstName?: string | null; lastName?: string | null; email?: string | null } | null;
    messages: Array<{ body: string; senderType: string; isIncoming: boolean }>;
  },
  context: OrchestratorContext,
  classification: TicketClassification,
): Promise<CandidateReply> {
  const customerName =
    ticket.customer?.firstName || ticket.customer?.lastName
      ? [ticket.customer?.firstName, ticket.customer?.lastName].filter(Boolean).join(" ")
      : ticket.customer?.email ?? "there";

  const recentMessages = ticket.messages
    .slice(-3)
    .map((m) => `[${m.isIncoming ? "Customer" : "Agent"}]: ${m.body.slice(0, 300)}`)
    .join("\n");

  const knowledgeContext = context.knowledgeMatches
    .map((m) => `Title: ${m.title}\n${m.content.slice(0, 400)}`)
    .join("\n\n");

  const instructionsContext = context.activeInstructions
    .map((i) => `${i.type} — ${i.name}: ${i.content}`)
    .join("\n");

  const prompt = [
    `You are a customer support agent responding on behalf of an online store.`,
    ``,
    `TICKET SUBJECT: ${ticket.subject}`,
    `CATEGORY: ${classification.category}`,
    `SENTIMENT: ${classification.sentiment}`,
    `CUSTOMER NAME: ${customerName}`,
    ``,
    instructionsContext ? `STORE POLICIES:\n${instructionsContext}` : "",
    knowledgeContext ? `RELEVANT KNOWLEDGE:\n${knowledgeContext}` : "",
    ``,
    `RECENT CONVERSATION:\n${recentMessages}`,
    ``,
    `Write a professional, empathetic reply to this customer. Be concise and helpful. Do not invent facts.`,
    `Sign off as "Support team".`,
    `Reply language: ${classification.language === "no" ? "Norwegian (bokmål)" : "English"}. Always write in the same language as the customer's latest message.`,
  ]
    .filter(Boolean)
    .join("\n");

  const aiResult = await callAIProvider(prompt);
  const aiText = aiResult?.text ?? null;

  // Use AI response or fall back to local template
  const finalText =
    aiText ??
    (classification.language === "no"
      ? [
          `Hei ${customerName},`,
          ``,
          `Takk for henvendelsen din om «${ticket.subject}». Vi har mottatt meldingen din og ser på saken.`,
          ``,
          context.knowledgeMatches.length > 0
            ? `Basert på informasjonen vi har: ${context.knowledgeMatches[0].content.slice(0, 200)}`
            : `Vi kommer tilbake til deg med en løsning så snart som mulig.`,
          ``,
          `Takk for tålmodigheten,`,
          `Support`,
        ]
      : [
      `Hi ${customerName},`,
      ``,
      `Thank you for reaching out about "${ticket.subject}". I've reviewed your message and I'm here to help.`,
      ``,
      context.knowledgeMatches.length > 0
        ? `Based on our records: ${context.knowledgeMatches[0].content.slice(0, 200)}`
        : `I'll look into this and get back to you with a resolution as soon as possible.`,
      ``,
      `Thanks for your patience,`,
      `Support team`,
    ]).join("\n");

  return {
    text: finalText,
    sourceReferences: context.knowledgeMatches.map((m) => m.title),
    model: aiResult?.provider ?? "local-template",
  };
}

// ── Validation ────────────────────────────────────────────────────────────────

function validateCandidate(
  candidate: CandidateReply,
  context: OrchestratorContext,
  classification: TicketClassification,
): ValidationResult {
  const warnings: string[] = [];

  // Check for unsupported claims (numbers/amounts not from knowledge)
  const hasMadeUpNumbers = /\$\d+|\d+%|\d+ days?/i.test(candidate.text) &&
    context.knowledgeMatches.every(
      (m) => !/\$\d+|\d+%|\d+ days?/i.test(m.content),
    );

  if (hasMadeUpNumbers) {
    warnings.push("Response contains specific numbers not found in knowledge base");
  }

  // Check if response actually addresses the question
  const answersQuestion = candidate.text.length > 50;

  if (!answersQuestion) {
    warnings.push("Response appears too short to be useful");
  }

  const isGrounded =
    context.knowledgeMatches.length > 0 || !hasMadeUpNumbers;

  if (!isGrounded) {
    warnings.push("Response not grounded in knowledge base — no relevant articles found");
  }

  return {
    isGrounded,
    hasUnsupportedClaims: hasMadeUpNumbers,
    answersQuestion,
    requiresHuman: classification.requiresHuman || hasMadeUpNumbers || !answersQuestion,
    warnings,
  };
}

// ── Main orchestrator ─────────────────────────────────────────────────────────

export async function runOrchestratorForTicket(
  ticketId: string,
  shopId: string,
): Promise<OrchestratorResult> {
  const ticket = await db.ticket.findUnique({
    where: { id: ticketId, shopId },
    include: {
      customer: true,
      messages: {
        orderBy: { createdAt: "asc" },
        take: 10,
      },
    },
  });

  if (!ticket) {
    throw new Error(`Ticket ${ticketId} not found`);
  }

  const latestMessage = [...ticket.messages]
    .reverse()
    .find((m) => m.isIncoming || m.senderType === "CUSTOMER");

  const query = [ticket.subject, latestMessage?.body ?? ""].join(" ");

  // Step 1: Classify
  const classification = classifyFromText(ticket.subject, latestMessage?.body ?? "");

  // Step 2: Retrieve context
  const context = await retrieveContext(shopId, query);

  // Step 3: Generate candidate
  const candidate = await generateCandidateReply(ticket, context, classification);

  // Step 4: Validate
  const validation = validateCandidate(candidate, context, classification);

  // Step 5: Automation decision — always HUMAN_REVIEW in Copilot mode (MVP)
  const decision = AIExecutionDecision.HUMAN_REVIEW;

  // Step 6: Save AIExecution record
  const promptJson = {
    classification: {
      category: classification.category,
      priority: classification.priority,
      sentiment: classification.sentiment,
      urgency: classification.urgency,
      requiresHuman: classification.requiresHuman,
      language: classification.language,
      confidence: classification.confidence,
    },
    contextSummary: {
      instructionCount: context.activeInstructions.length,
      knowledgeMatchCount: context.knowledgeMatches.length,
      knowledgeTitles: context.knowledgeMatches.map((m) => m.title),
    },
  };

  const resultJson = {
    suggestedReply: candidate.text,
    sourceReferences: candidate.sourceReferences,
    model: candidate.model,
    validation: {
      isGrounded: validation.isGrounded,
      hasUnsupportedClaims: validation.hasUnsupportedClaims,
      answersQuestion: validation.answersQuestion,
      warnings: validation.warnings,
    },
  };

  const aiExecution = await db.aIExecution.create({
    data: {
      shopId,
      ticketId,
      model: candidate.model,
      decision,
      confidence: classification.confidence,
      prompt: promptJson,
      result: resultJson,
      status: "COMPLETED",
    },
  });

  // Update ticket AI status
  await db.ticket.update({
    where: { id: ticketId },
    data: {
      aiStatus: validation.requiresHuman ? "REVIEW" : "HANDLED",
      category: classification.category,
      language: classification.language,
      priority: classification.priority,
    },
  });

  return {
    classification,
    context,
    candidate,
    validation,
    decision,
    aiExecutionId: aiExecution.id,
  };
}
