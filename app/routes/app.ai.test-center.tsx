import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, useActionData, useLoaderData } from "react-router";
import db from "../db.server";
import { authenticateAdminOrFallback } from "../shopify.server";
import { normalizeShopDomain } from "../services/shop.service.server";
import { runAITestSimulation, type AITestResult } from "../services/ai.test-center.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticateAdminOrFallback(request);
  const shop = await db.shop.findUnique({
    where: { domain: normalizeShopDomain(session.shop) },
  });

  if (!shop) throw new Response("Shop not found", { status: 404 });

  const aiSetting = await db.aISetting.findUnique({
    where: { shopId: shop.id },
  });

  return {
    shopName: shop.name,
    autoSendEnabled: aiSetting?.autoSendEnabled ?? false,
    minConfidenceThreshold: aiSetting?.minConfidenceThreshold ?? 0.85,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticateAdminOrFallback(request);
  const formData = await request.formData();
  const query = String(formData.get("query") ?? "").trim();

  const shop = await db.shop.findUnique({
    where: { domain: normalizeShopDomain(session.shop) },
  });
  if (!shop) throw new Response("Shop not found", { status: 404 });

  if (!query) {
    return { error: "Please enter a customer query to test." };
  }

  try {
    const result = await runAITestSimulation({
      shopId: shop.id,
      customerQuery: query,
    });
    return { result };
  } catch (err: any) {
    const msg: string = err?.message ?? String(err);
    if (msg.includes("credit balance is too low")) {
      return { error: "⚠️ Anthropic account has no credits — and GEMINI_API_KEY is not set as fallback.\n\nFix: Add your Gemini key (free tier) to .env:\nGEMINI_API_KEY=AIza...\n\nGet it at: https://aistudio.google.com/apikey" };
    }
    if (msg.includes("GEMINI_API_KEY is not set")) {
      return { error: "⚠️ GEMINI_API_KEY is missing from .env. Add it on line 24 and save the file." };
    }
    if (msg.includes("401") || msg.includes("invalid_api_key") || msg.includes("API_KEY_INVALID")) {
      return { error: "⚠️ Invalid API key. Check your GEMINI_API_KEY or ANTHROPIC_API_KEY in .env." };
    }
    return { error: `AI error: ${msg.slice(0, 300)}` };
  }
};

export default function AITestCenterPage() {
  const { shopName, minConfidenceThreshold } = useLoaderData<typeof loader>();
  const actionData = useActionData<{ result?: AITestResult; error?: string }>();

  return (
    <div style={{ fontFamily: "Inter, system-ui, sans-serif", maxWidth: 860, margin: "0 auto", padding: "32px 24px" }}>
      {/* Header */}
      <div style={{ marginBottom: 32 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
          <span style={{ fontSize: 28 }}>🧪</span>
          <h1 style={{ margin: 0, fontSize: 24, fontWeight: 700, color: "#111827" }}>AI Test Center</h1>
        </div>
        <p style={{ margin: 0, color: "#6b7280", fontSize: 14 }}>
          {shopName} · Confidence threshold: {(minConfidenceThreshold * 100).toFixed(0)}% · Sandbox mode — no emails or mutations
        </p>
      </div>

      {/* Query Form */}
      <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 12, padding: 24, marginBottom: 24 }}>
        <h2 style={{ margin: "0 0 16px", fontSize: 16, fontWeight: 600, color: "#374151" }}>Simulate Customer Query</h2>
        <Form method="post">
          <div style={{ marginBottom: 16 }}>
            <label style={{ display: "block", fontSize: 14, fontWeight: 500, color: "#374151", marginBottom: 6 }}>
              Customer Query
            </label>
            <textarea
              name="query"
              rows={3}
              placeholder="e.g. Can I return my order if I opened the box?"
              style={{
                width: "100%",
                padding: "10px 14px",
                fontSize: 14,
                border: "1px solid #d1d5db",
                borderRadius: 8,
                boxSizing: "border-box",
                resize: "vertical",
                fontFamily: "inherit",
                outline: "none",
              }}
            />
          </div>
          <button
            type="submit"
            style={{
              padding: "10px 20px",
              background: "#4f46e5",
              color: "#fff",
              border: "none",
              borderRadius: 8,
              fontSize: 14,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            ▶ Run Simulation
          </button>
        </Form>
      </div>

      {/* Error */}
      {actionData?.error && (
        <div style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 8, padding: 16, marginBottom: 24, color: "#991b1b" }}>
          {actionData.error}
        </div>
      )}

      {/* Results */}
      {actionData?.result && (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {/* Decision Banner */}
          <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 12, padding: 20 }}>
            <h2 style={{ margin: "0 0 16px", fontSize: 16, fontWeight: 600, color: "#374151" }}>Simulation Results</h2>
            <div style={{ display: "flex", gap: 24, flexWrap: "wrap", alignItems: "center" }}>
              <div>
                <span style={{ fontSize: 12, color: "#6b7280", display: "block", marginBottom: 4 }}>CATEGORY</span>
                <span style={{ fontWeight: 600, color: "#111827" }}>{actionData.result.category}</span>
              </div>
              <div>
                <span style={{ fontSize: 12, color: "#6b7280", display: "block", marginBottom: 4 }}>CONFIDENCE</span>
                <span style={{ fontWeight: 600, color: "#111827" }}>{(actionData.result.confidence * 100).toFixed(0)}%</span>
              </div>
              <div>
                <span style={{ fontSize: 12, color: "#6b7280", display: "block", marginBottom: 4 }}>DECISION</span>
                <span style={{
                  padding: "4px 12px",
                  borderRadius: 20,
                  fontSize: 13,
                  fontWeight: 700,
                  color: "#fff",
                  background: actionData.result.decision === "AUTO_SEND" ? "#16a34a" : "#d97706",
                }}>
                  {actionData.result.decision}
                </span>
              </div>
            </div>
            <div style={{ marginTop: 16, padding: 12, background: "#f9fafb", borderRadius: 8, fontSize: 14, color: "#374151" }}>
              <strong>Policy reason:</strong> {actionData.result.decisionReason}
            </div>
          </div>

          {/* Generated Response */}
          <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 12, padding: 20 }}>
            <h3 style={{ margin: "0 0 12px", fontSize: 15, fontWeight: 600, color: "#374151" }}>Generated Response</h3>
            <p style={{ margin: 0, fontStyle: "italic", whiteSpace: "pre-wrap", color: "#1f2937", lineHeight: 1.7 }}>
              "{actionData.result.generatedResponse}"
            </p>
          </div>

          {/* Knowledge Sources */}
          <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 12, padding: 20 }}>
            <h3 style={{ margin: "0 0 12px", fontSize: 15, fontWeight: 600, color: "#374151" }}>
              Retrieved Knowledge Sources ({actionData.result.retrievedSources.length})
            </h3>
            {actionData.result.retrievedSources.length === 0 ? (
              <p style={{ color: "#9ca3af", fontSize: 14, margin: 0 }}>No matching knowledge chunks found.</p>
            ) : (
              actionData.result.retrievedSources.map((source, idx) => (
                <div key={idx} style={{ padding: "12px 0", borderBottom: idx < actionData.result!.retrievedSources.length - 1 ? "1px solid #f3f4f6" : "none" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                    <strong style={{ fontSize: 14, color: "#111827" }}>{source.documentTitle}</strong>
                    <span style={{ fontSize: 12, color: "#6b7280" }}>Relevance: {(source.score * 100).toFixed(0)}%</span>
                  </div>
                  <p style={{ margin: 0, fontSize: 13, color: "#4b5563", lineHeight: 1.5 }}>{source.snippet}</p>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
