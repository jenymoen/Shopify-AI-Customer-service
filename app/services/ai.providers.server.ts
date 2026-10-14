import db from "../db.server";
import { decryptSecret, encryptSecret } from "../lib/crypto.server";
import { getProviderInfo, type AIProviderId } from "../lib/ai-providers";

const REQUEST_TIMEOUT_MS = 45_000;
const MAX_TOKENS = 1024;

// Providers that speak the OpenAI chat-completions protocol.
const OPENAI_COMPATIBLE_URLS: Partial<Record<AIProviderId, string>> = {
  openai: "https://api.openai.com/v1/chat/completions",
  moonshot: "https://api.moonshot.ai/v1/chat/completions",
  deepseek: "https://api.deepseek.com/chat/completions",
  mistral: "https://api.mistral.ai/v1/chat/completions",
  xai: "https://api.x.ai/v1/chat/completions",
};

async function postJson(url: string, headers: Record<string, string>, body: unknown) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!res.ok) {
    const detail = (await res.text()).slice(0, 300);
    throw new Error(`HTTP ${res.status}: ${detail}`);
  }
  return res.json();
}

async function callProvider(provider: string, model: string, apiKey: string, prompt: string): Promise<string | null> {
  if (provider === "anthropic") {
    const json = (await postJson(
      "https://api.anthropic.com/v1/messages",
      { "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
      { model, max_tokens: MAX_TOKENS, messages: [{ role: "user", content: prompt }] },
    )) as { content?: Array<{ type: string; text?: string }> };
    return json.content?.find((c) => c.type === "text")?.text?.trim() || null;
  }

  if (provider === "google") {
    const json = (await postJson(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
      { "x-goog-api-key": apiKey },
      { contents: [{ role: "user", parts: [{ text: prompt }] }] },
    )) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
    const text = json.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("");
    return text?.trim() || null;
  }

  const url = OPENAI_COMPATIBLE_URLS[provider as AIProviderId];
  if (!url) throw new Error(`Unknown AI provider "${provider}"`);
  const json = (await postJson(
    url,
    { Authorization: `Bearer ${apiKey}` },
    { model, max_tokens: MAX_TOKENS, messages: [{ role: "user", content: prompt }] },
  )) as { choices?: Array<{ message?: { content?: string } }> };
  return json.choices?.[0]?.message?.content?.trim() || null;
}

export interface ShopProviderResult {
  text: string;
  provider: string;
  model: string;
}

export async function hasEnabledShopProviders(shopId: string) {
  return (await db.aIProviderConfig.count({ where: { shopId, isEnabled: true } })) > 0;
}

/**
 * Tries the shop's enabled providers in priority order and returns the first
 * successful answer. Returns null when none are configured or all of them fail.
 */
export async function generateTextWithShopProviders(
  shopId: string,
  prompt: string,
): Promise<ShopProviderResult | null> {
  const configs = await db.aIProviderConfig.findMany({
    where: { shopId, isEnabled: true },
    orderBy: [{ priority: "asc" }, { createdAt: "asc" }],
  });

  for (const config of configs) {
    try {
      const text = await callProvider(config.provider, config.model, decryptSecret(config.apiKeyEncrypted), prompt);
      if (text) return { text, provider: config.provider, model: config.model };
      console.warn(`[ai] ${config.provider} returned an empty answer, trying next provider`);
    } catch (err) {
      console.error(`[ai] ${config.provider} (${config.model}) failed, trying next provider:`, err);
    }
  }
  return null;
}

/** Sends a tiny request to verify a key/model pair. Returns an error message, or null when it works. */
export async function testProviderConnection(provider: string, model: string, apiKey: string): Promise<string | null> {
  try {
    const text = await callProvider(provider, model, apiKey, "Reply with the single word: OK");
    return text ? null : "The provider returned an empty answer.";
  } catch (err) {
    return err instanceof Error ? err.message : "Unknown error";
  }
}

// ── Settings management ───────────────────────────────────────────────────────

export function maskApiKey(apiKey: string) {
  return apiKey.length > 8 ? `••••${apiKey.slice(-4)}` : "••••";
}

export async function listShopProviders(shopId: string) {
  const configs = await db.aIProviderConfig.findMany({
    where: { shopId },
    orderBy: [{ priority: "asc" }, { createdAt: "asc" }],
  });
  return configs.map((c) => {
    let maskedKey = "••••";
    try {
      maskedKey = maskApiKey(decryptSecret(c.apiKeyEncrypted));
    } catch {
      // Key can no longer be decrypted (e.g. ENCRYPTION_KEY changed); the user needs to paste it again.
    }
    return { provider: c.provider, model: c.model, isEnabled: c.isEnabled, priority: c.priority, maskedKey };
  });
}

export async function saveShopProvider({
  shopId,
  provider,
  model,
  apiKey,
}: {
  shopId: string;
  provider: string;
  model: string;
  apiKey: string;
}) {
  const info = getProviderInfo(provider);
  if (!info) throw new Error("Unknown AI provider.");
  if (!info.models.some((m) => m.id === model)) throw new Error("Choose a model from the list.");

  const existing = await db.aIProviderConfig.findUnique({ where: { shopId_provider: { shopId, provider } } });
  if (!existing && !apiKey) throw new Error("Paste an API key to add this provider.");

  if (existing) {
    await db.aIProviderConfig.update({
      where: { id: existing.id },
      data: { model, ...(apiKey ? { apiKeyEncrypted: encryptSecret(apiKey) } : {}) },
    });
    return;
  }

  // New providers go last in the priority order.
  const last = await db.aIProviderConfig.aggregate({ where: { shopId }, _max: { priority: true } });
  await db.aIProviderConfig.create({
    data: { shopId, provider, model, apiKeyEncrypted: encryptSecret(apiKey), priority: (last._max.priority ?? 0) + 1 },
  });
}

export async function setShopProviderEnabled(shopId: string, provider: string, isEnabled: boolean) {
  await db.aIProviderConfig.updateMany({ where: { shopId, provider }, data: { isEnabled } });
}

async function orderedConfigs(shopId: string) {
  return db.aIProviderConfig.findMany({
    where: { shopId },
    orderBy: [{ priority: "asc" }, { createdAt: "asc" }],
    select: { id: true, provider: true },
  });
}

function renumber(configs: Array<{ id: string }>) {
  return db.$transaction(
    configs.map((c, i) => db.aIProviderConfig.update({ where: { id: c.id }, data: { priority: i + 1 } })),
  );
}

export async function removeShopProvider(shopId: string, provider: string) {
  await db.aIProviderConfig.deleteMany({ where: { shopId, provider } });
  await renumber(await orderedConfigs(shopId));
}

export async function moveShopProvider(shopId: string, provider: string, direction: "up" | "down") {
  const ordered = await orderedConfigs(shopId);
  const index = ordered.findIndex((c) => c.provider === provider);
  const target = direction === "up" ? index - 1 : index + 1;
  if (index === -1 || target < 0 || target >= ordered.length) return;

  [ordered[index], ordered[target]] = [ordered[target], ordered[index]];
  await renumber(ordered);
}

export async function getShopProviderCredentials(shopId: string, provider: string) {
  const config = await db.aIProviderConfig.findUnique({ where: { shopId_provider: { shopId, provider } } });
  return config ? { model: config.model, apiKey: decryptSecret(config.apiKeyEncrypted) } : null;
}
