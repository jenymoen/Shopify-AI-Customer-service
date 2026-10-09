import db from "../db.server";
import { appConfig } from "../lib/config.server";

const CHUNK_SIZE = 500;
const CHUNK_OVERLAP = 50;

function splitIntoChunks(text: string): string[] {
  const chunks: string[] = [];
  let start = 0;

  while (start < text.length) {
    const end = Math.min(start + CHUNK_SIZE, text.length);
    const chunk = text.slice(start, end).trim();
    if (chunk.length > 20) {
      chunks.push(chunk);
    }
    start += CHUNK_SIZE - CHUNK_OVERLAP;
  }

  return chunks;
}

async function generateTextEmbedding(text: string): Promise<number[] | null> {
  if (!appConfig.EMBEDDING_API_KEY) {
    // Stub: generate a deterministic pseudo-embedding for dev (not for real semantic search)
    const hash = Array.from(text.slice(0, 64)).reduce(
      (acc, ch) => (acc * 31 + ch.charCodeAt(0)) % 1000,
      0,
    );
    // Return a 1536-dim zero vector with one non-zero element for stub
    const vec = new Array(1536).fill(0);
    vec[hash % 1536] = 1;
    return vec;
  }

  try {
    const res = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${appConfig.EMBEDDING_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "text-embedding-3-small",
        input: text.slice(0, 8192),
      }),
    });

    if (!res.ok) {
      console.error("[knowledge] Embedding API error:", res.status, await res.text());
      return null;
    }

    const json = (await res.json()) as { data?: Array<{ embedding: number[] }> };
    return json.data?.[0]?.embedding ?? null;
  } catch (err) {
    console.error("[knowledge] Embedding generation failed:", err);
    return null;
  }
}

export async function chunkAndEmbedDocument(documentId: string): Promise<void> {
  const document = await db.knowledgeDocument.findUnique({
    where: { id: documentId },
    select: { id: true, shopId: true, title: true, content: true },
  });

  if (!document) return;

  // Delete old chunks for this document
  await db.knowledgeChunk.deleteMany({ where: { documentId } });

  const fullText = `${document.title}\n\n${document.content}`;
  const chunks = splitIntoChunks(fullText);

  for (let i = 0; i < chunks.length; i++) {
    const embedding = await generateTextEmbedding(chunks[i]);

    if (embedding) {
      // Use raw SQL to insert with vector type (pgvector)
      await db.$executeRaw`
        INSERT INTO "KnowledgeChunk" (id, "shopId", "documentId", "chunkIndex", content, embedding, "createdAt")
        VALUES (
          gen_random_uuid()::text,
          ${document.shopId},
          ${documentId},
          ${i},
          ${chunks[i]},
          ${JSON.stringify(embedding)}::vector,
          NOW()
        )
      `;
    } else {
      // Insert without embedding (keyword-only search will still work)
      await db.$executeRaw`
        INSERT INTO "KnowledgeChunk" (id, "shopId", "documentId", "chunkIndex", content, "createdAt")
        VALUES (
          gen_random_uuid()::text,
          ${document.shopId},
          ${documentId},
          ${i},
          ${chunks[i]},
          NOW()
        )
      `;
    }
  }

  console.log(`[knowledge] Chunked document ${documentId} into ${chunks.length} chunks`);
}


export async function searchKnowledgeForTicket({
  shopId,
  query,
  limit = 5,
}: {
  shopId: string;
  query: string;
  limit?: number;
}) {
  const normalizedQuery = query.trim();
  if (!normalizedQuery) {
    return [] as Array<{ id: string; title: string; content: string; score: number; sourceType: string; sourceUrl?: string | null }>;
  }

  const terms = normalizedQuery
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);

  if (terms.length === 0) {
    return [] as Array<{ id: string; title: string; content: string; score: number; sourceType: string; sourceUrl?: string | null }>;
  }

  const documents = await db.knowledgeDocument.findMany({
    where: {
      shopId,
      status: "PUBLISHED",
    },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      title: true,
      sourceType: true,
      sourceUrl: true,
      content: true,
    },
  });

  const ranked = documents
    .map((document) => {
      const haystack = `${document.title} ${document.content}`.toLowerCase();
      const matches = terms.filter((term) => haystack.includes(term)).length;
      const score = matches + (document.title.toLowerCase().includes(normalizedQuery.toLowerCase()) ? 2 : 0);

      return {
        id: document.id,
        title: document.title,
        content: document.content,
        score,
        sourceType: document.sourceType,
        sourceUrl: document.sourceUrl,
      };
    })
    .filter((document) => document.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  return ranked;
}

export async function getActiveAiInstructionsForShop(shopId: string) {
  return db.aIInstruction.findMany({
    where: {
      shopId,
      isActive: true,
    },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      type: true,
      content: true,
    },
  });
}
