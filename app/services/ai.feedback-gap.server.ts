import db from "../db.server";
import { logAuditEvent } from "./audit.service.server";

// Simple Levenshtein distance calculation for edit distance tracking
function calculateEditDistance(a: string, b: string): number {
  const matrix: number[][] = [];
  for (let i = 0; i <= b.length; i++) matrix[i] = [i];
  for (let j = 0; j <= a.length; j++) matrix[0][j] = j;

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }
  return matrix[b.length][a.length];
}

export async function recordAgentFeedback({
  shopId,
  aiExecutionId,
  userId,
  rating,
  comment,
  candidateText,
  finalText,
}: {
  shopId: string;
  aiExecutionId: string;
  userId?: string;
  rating: "POSITIVE" | "NEGATIVE";
  comment?: string;
  candidateText?: string;
  finalText?: string;
}) {
  let editDistance: number | undefined = undefined;
  if (candidateText && finalText) {
    editDistance = calculateEditDistance(candidateText, finalText);
  }

  const feedback = await db.aIFeedback.create({
    data: {
      shopId,
      aiExecutionId,
      userId: userId ?? null,
      rating,
      comment: comment?.trim() ?? null,
      finalText: finalText?.trim() ?? null,
      editDistance: editDistance ?? null,
    },
  });

  if (userId) {
    await logAuditEvent({
      shopId,
      actorUserId: userId,
      entityType: "ai_feedback",
      entityId: feedback.id,
      eventType: "ai.feedback.submitted",
      details: { rating, editDistance },
    });
  }

  return feedback;
}

export async function recordKnowledgeGap({
  shopId,
  category,
  querySummary,
  failureReason,
  suggestedArticleTitle,
  suggestedContent,
}: {
  shopId: string;
  category: string;
  querySummary: string;
  failureReason: string;
  suggestedArticleTitle?: string;
  suggestedContent?: string;
}) {
  return db.knowledgeGap.create({
    data: {
      shopId,
      category,
      querySummary,
      failureReason,
      suggestedArticleTitle: suggestedArticleTitle?.trim() ?? null,
      suggestedContent: suggestedContent?.trim() ?? null,
      status: "OPEN",
    },
  });
}

export async function listKnowledgeGaps(shopId: string) {
  return db.knowledgeGap.findMany({
    where: { shopId, status: "OPEN" },
    orderBy: { createdAt: "desc" },
  });
}

export async function resolveKnowledgeGap(gapId: string) {
  return db.knowledgeGap.update({
    where: { id: gapId },
    data: { status: "RESOLVED" },
  });
}
