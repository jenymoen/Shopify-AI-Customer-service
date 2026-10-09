import db from "../db.server";

export interface InstructionCondition {
  category?: string;
  sentiment?: string;
  language?: string;
  priority?: string;
}

export function matchesInstructionConditions(
  conditionsJson: unknown,
  classification: { category: string; priority: string; sentiment?: string; language?: string }
): boolean {
  if (!conditionsJson || typeof conditionsJson !== "object") return true;

  const cond = conditionsJson as InstructionCondition;

  if (cond.category && cond.category.toUpperCase() !== classification.category.toUpperCase()) {
    return false;
  }

  if (cond.sentiment && classification.sentiment && cond.sentiment.toUpperCase() !== classification.sentiment.toUpperCase()) {
    return false;
  }

  if (cond.language && classification.language && cond.language.toLowerCase() !== classification.language.toLowerCase()) {
    return false;
  }

  if (cond.priority && cond.priority.toUpperCase() !== classification.priority.toUpperCase()) {
    return false;
  }

  return true;
}

export async function evaluateAssistedModeDecision({
  shopId,
  category,
  confidence,
  validationResult,
}: {
  shopId: string;
  category: string;
  confidence: number;
  validationResult: { isGrounded: boolean; hasUnsupportedClaims: boolean; requiresHuman: boolean };
}): Promise<{ decision: "AUTO_SEND" | "HUMAN_REVIEW"; reason: string }> {
  const setting = await db.aISetting.findUnique({ where: { shopId } });

  // If assisted mode is disabled for shop, default to HUMAN_REVIEW (Copilot Mode)
  if (!setting || !setting.autoSendEnabled) {
    return { decision: "HUMAN_REVIEW", reason: "Assisted mode is not enabled for this shop (Copilot mode default)." };
  }

  // Guardrail check: if validation fails grounding or has unsupported claims or requires human, force HUMAN_REVIEW
  if (!validationResult.isGrounded || validationResult.hasUnsupportedClaims || validationResult.requiresHuman) {
    return { decision: "HUMAN_REVIEW", reason: "Validation guardrails triggered (unsupported claims or human review flag)." };
  }

  // Threshold check
  if (confidence < setting.minConfidenceThreshold) {
    return {
      decision: "HUMAN_REVIEW",
      reason: `Confidence (${confidence}) is below threshold (${setting.minConfidenceThreshold}).`,
    };
  }

  // Category check
  if (setting.allowedCategories.length > 0 && !setting.allowedCategories.map((c) => c.toUpperCase()).includes(category.toUpperCase())) {
    return {
      decision: "HUMAN_REVIEW",
      reason: `Category '${category}' is not in approved auto-send list.`,
    };
  }

  return { decision: "AUTO_SEND", reason: "Assisted mode policy criteria satisfied." };
}
