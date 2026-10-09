import db from "../db.server";
import { searchKnowledgeForTicket } from "./knowledge.service.server";
import { evaluateAssistedModeDecision } from "./ai.policy.server";
import {
  classifyCustomerQuery as classifyGemini,
  generateSupportResponse as generateGemini,
  isRetryableGeminiError,
} from "./ai.gemini.server";
import { classifyCustomerQuery as classifyAnthropic, generateSupportResponse as generateAnthropic } from "./ai.anthropic.server";

export interface AITestResult {
  query: string;
  category: string;
  confidence: number;
  retrievedSources: Array<{ documentTitle: string; snippet: string; score: number }>;
  decision: "AUTO_SEND" | "HUMAN_REVIEW";
  decisionReason: string;
  generatedResponse: string;
  validation: { isGrounded: boolean; hasUnsupportedClaims: boolean; requiresHuman: boolean };
}

/**
 * Gemini is preferred when configured. If it is still overloaded after its own
 * retries, fall back to Anthropic when that key is set too.
 */
async function withProviderFallback<T>(
  hasGeminiKey: boolean,
  hasAnthropicKey: boolean,
  gemini: () => Promise<T>,
  anthropic: () => Promise<T>,
): Promise<T> {
  if (!hasGeminiKey) return anthropic();
  try {
    return await gemini();
  } catch (error) {
    if (!hasAnthropicKey || !isRetryableGeminiError(error)) throw error;
    console.warn("Gemini unavailable, falling back to Anthropic", error);
    try {
      return await anthropic();
    } catch (fallbackError) {
      // Surface the original Gemini error; the fallback failure is only logged.
      console.error("Anthropic fallback failed", fallbackError);
      throw error;
    }
  }
}

export async function runAITestSimulation({
  shopId,
  customerQuery,
}: {
  shopId: string;
  customerQuery: string;
}): Promise<AITestResult> {
  const hasGeminiKey = !!process.env.GEMINI_API_KEY;
  const hasAnthropicKey = !!process.env.ANTHROPIC_API_KEY;
  const useRealAI = hasGeminiKey || hasAnthropicKey;

  // Step 1: Retrieve relevant knowledge chunks
  const chunks = await searchKnowledgeForTicket({ shopId, query: customerQuery, limit: 3 });
  const retrievedSources = chunks.map((c: { title: string; content: string; score: number }) => ({
    documentTitle: c.title,
    snippet: c.content.slice(0, 200),
    score: Math.min(1, c.score), // normalize to 0-1
  }));

  let category: string;
  let confidence: number;
  let generatedResponse: string;
  let isGrounded: boolean;
  let hasUnsupportedClaims: boolean;

  // Gemini preferred, Anthropic as fallback (see withProviderFallback)
  const classify = (query: string) =>
    withProviderFallback(hasGeminiKey, hasAnthropicKey, () => classifyGemini(query), () => classifyAnthropic(query));
  const generate = (args: Parameters<typeof generateGemini>[0]) =>
    withProviderFallback(hasGeminiKey, hasAnthropicKey, () => generateGemini(args), () => generateAnthropic(args));

  if (useRealAI) {
    const [classification, shopRecord] = await Promise.all([
      classify(customerQuery),
      db.shop.findUnique({ where: { id: shopId } }),
    ]);

    category = classification.category;
    confidence = classification.confidence;

    // Real AI: generate grounded response
    const responseResult = await generate({
      customerQuery,
      knowledgeChunks: chunks.map((c: { title: string; content: string }) => ({
        title: c.title,
        content: c.content,
      })),
      shopName: shopRecord?.name ?? "our store",
      category,
    });

    generatedResponse = responseResult.response;
    isGrounded = responseResult.isGrounded;
    hasUnsupportedClaims = responseResult.hasUnsupportedClaims;
  } else {
    // Fallback stub — used when ANTHROPIC_API_KEY is not set
    const lowerQuery = customerQuery.toLowerCase();
    if (lowerQuery.includes("return") || lowerQuery.includes("refund")) category = "RETURNS";
    else if (lowerQuery.includes("shipping") || lowerQuery.includes("delivery")) category = "SHIPPING";
    else if (lowerQuery.includes("login") || lowerQuery.includes("account") || lowerQuery.includes("konto") || lowerQuery.includes("logg inn")) category = "ACCOUNT_ACCESS";
    else if (lowerQuery.includes("cancel")) category = "CANCELLATION";
    else category = "GENERAL";

    confidence = 0.75;

    // Without real AI, we can't safely answer — show an honest message
    generatedResponse = `⚠️ AI not connected yet. Add GEMINI_API_KEY or ANTHROPIC_API_KEY to .env to get real AI responses.\n\nCategory detected: ${category}\nKnowledge sources found: ${retrievedSources.length} (shown below)\n\nGemini (free tier): https://aistudio.google.com/apikey\nAnthropic Claude: https://console.anthropic.com/settings/keys`;

    isGrounded = retrievedSources.length > 0;
    hasUnsupportedClaims = !isGrounded;
  }

  const validation = {
    isGrounded,
    hasUnsupportedClaims,
    requiresHuman: confidence < 0.8,
  };

  // Policy evaluation
  const policy = await evaluateAssistedModeDecision({
    shopId,
    category,
    confidence,
    validationResult: validation,
  });

  return {
    query: customerQuery,
    category,
    confidence,
    retrievedSources,
    decision: policy.decision,
    decisionReason: policy.reason,
    generatedResponse,
    validation,
  };
}
