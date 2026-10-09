import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  SHOPIFY_API_KEY: z.string().min(1),
  SHOPIFY_API_SECRET: z.string().min(1),
  SHOPIFY_APP_URL: z.string().url(),
  SCOPES: z.string().default("read_customers,read_orders,read_products"),
  SESSION_SECRET: z.string().min(32),
  ENCRYPTION_KEY: z.string().min(32),
  TOKEN_HASH_SECRET: z.string().min(16),
  EMAIL_PROVIDER: z.string().default("postmark"),
  EMAIL_API_KEY: z.string().optional(),
  AI_PROVIDER: z.string().default("anthropic"),
  AI_API_KEY: z.string().optional(),
  EMBEDDING_PROVIDER: z.string().default("openai"),
  EMBEDDING_API_KEY: z.string().optional(),
  STORAGE_PROVIDER: z.string().default("local"),
  LOG_LEVEL: z.string().default("info"),
});

export const appConfig = envSchema.parse(process.env);
