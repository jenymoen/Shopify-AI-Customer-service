export type AIProviderId = "anthropic" | "openai" | "google" | "moonshot" | "deepseek" | "mistral" | "xai";

export interface AIProviderInfo {
  id: AIProviderId;
  label: string;
  keyUrl: string;
  models: Array<{ id: string; label: string }>;
}

export const AI_PROVIDERS: AIProviderInfo[] = [
  {
    id: "anthropic",
    label: "Claude (Anthropic)",
    keyUrl: "https://console.anthropic.com/settings/keys",
    models: [
      { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5" },
      { id: "claude-opus-5-5", label: "Claude Opus 5.5" },
      { id: "claude-haiku-5-5", label: "Claude Haiku 5.5" },
      { id: "claude-sonnet-4-5", label: "Claude Sonnet 4.5" },
    ],
  },
  {
    id: "openai",
    label: "ChatGPT (OpenAI)",
    keyUrl: "https://platform.openai.com/api-keys",
    models: [
      { id: "gpt-4.1", label: "GPT-4.1" },
      { id: "gpt-4o", label: "GPT-4o" },
      { id: "gpt-4o-mini", label: "GPT-4o mini" },
    ],
  },
  {
    id: "google",
    label: "Gemini (Google)",
    keyUrl: "https://aistudio.google.com/apikey",
    models: [
      { id: "gemini-3.6-flash", label: "Gemini 3.6 Flash" },
      { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro" },
      { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash" },
    ],
  },
  {
    id: "moonshot",
    label: "Kimi (Moonshot AI)",
    keyUrl: "https://platform.moonshot.ai/console/api-keys",
    models: [
      { id: "kimi-k2-0905-preview", label: "Kimi K2" },
      { id: "kimi-k2-turbo-preview", label: "Kimi K2 Turbo" },
    ],
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    keyUrl: "https://platform.deepseek.com/api_keys",
    models: [
      { id: "deepseek-chat", label: "DeepSeek Chat (V3)" },
      { id: "deepseek-reasoner", label: "DeepSeek Reasoner (R1)" },
    ],
  },
  {
    id: "mistral",
    label: "Mistral",
    keyUrl: "https://console.mistral.ai/api-keys",
    models: [
      { id: "mistral-large-latest", label: "Mistral Large" },
      { id: "mistral-small-latest", label: "Mistral Small" },
    ],
  },
  {
    id: "xai",
    label: "Grok (xAI)",
    keyUrl: "https://console.x.ai",
    models: [
      { id: "grok-4", label: "Grok 4" },
      { id: "grok-3", label: "Grok 3" },
    ],
  },
];

export function getProviderInfo(id: string): AIProviderInfo | undefined {
  return AI_PROVIDERS.find((p) => p.id === id);
}
