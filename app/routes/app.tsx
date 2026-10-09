import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Outlet, useLoaderData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";

import { authenticateAdminOrFallback } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticateAdminOrFallback(request);
  const url = new URL(request.url);
  const isEmbedded =
    url.searchParams.has("embedded") ||
    request.headers.has("authorization") ||
    request.headers.has("x-shopify-access-token");

  // eslint-disable-next-line no-undef
  return { apiKey: process.env.SHOPIFY_API_KEY || "", isEmbedded };
};

export default function App() {
  const { apiKey, isEmbedded } = useLoaderData<typeof loader>();

  if (!isEmbedded) {
    return (
      <div style={{ fontFamily: "Inter, system-ui, sans-serif", minHeight: "100vh", background: "#f9fafb" }}>
        <nav style={{
          background: "#1f2937",
          padding: "0 24px",
          display: "flex",
          alignItems: "center",
          gap: 4,
          height: 52,
        }}>
          <span style={{ color: "#9ca3af", fontSize: 13, marginRight: 12, fontWeight: 600 }}>Avento CS</span>
          {[
            ["/app", "Home"],
            ["/app/inbox", "Inbox"],
            ["/app/teams", "Teams"],
            ["/app/automation", "Automation"],
            ["/app/incidents", "Incidents"],
            ["/app/ai/knowledge", "AI Knowledge"],
            ["/app/ai/test-center", "AI Test Center"],
            ["/app/action-policies", "Action Policies"],
            ["/app/invite", "Invite"],
            ["/app/settings/email", "Email"],
            ["/portal/dashboard", "Portal →"],
          ].map(([href, label]) => (
            <a
              key={href}
              href={href}
              style={{
                color: "#d1d5db",
                textDecoration: "none",
                padding: "6px 12px",
                borderRadius: 6,
                fontSize: 13,
                fontWeight: 500,
              }}
              onMouseEnter={e => (e.currentTarget.style.background = "#374151")}
              onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
            >
              {label}
            </a>
          ))}
        </nav>
        <main style={{ padding: "0" }}>
          <Outlet />
        </main>
      </div>
    );
  }

  return (
    <AppProvider embedded apiKey={apiKey}>
      <s-app-nav>
        <s-link href="/app">Home</s-link>
        <s-link href="/app/inbox">Inbox</s-link>
        <s-link href="/app/teams">Teams</s-link>
        <s-link href="/app/automation">Automation</s-link>
        <s-link href="/app/incidents">Incidents</s-link>
        <s-link href="/app/ai/instructions">AI Instructions</s-link>
        <s-link href="/app/ai/knowledge">AI Knowledge</s-link>
        <s-link href="/app/ai/test-center">AI Test Center</s-link>
        <s-link href="/app/action-policies">Action Policies</s-link>
        <s-link href="/app/invite">Invite</s-link>
        <s-link href="/app/settings/email">Email settings</s-link>
      </s-app-nav>
      <Outlet />
    </AppProvider>
  );
}

// Shopify needs React Router to catch some thrown responses, so that their headers are included in the response.
export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
