import type { Config } from "@react-router/dev/config";

// Behind the Shopify CLI tunnel the browser's Origin (https://<tunnel>) does not
// match the request URL the dev server sees (http), which React Router's CSRF
// check rejects with "Bad Request". Allow the app's own public host explicitly.
const appHost = process.env.SHOPIFY_APP_URL
  ? new URL(process.env.SHOPIFY_APP_URL).host
  : undefined;

export default {
  allowedActionOrigins: [
    ...(appHost ? [appHost] : []),
    ...(process.env.NODE_ENV === "production" ? [] : ["*.trycloudflare.com"]),
  ],
} satisfies Config;
