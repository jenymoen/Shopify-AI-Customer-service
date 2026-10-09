import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, redirect, useLoaderData } from "react-router";
import db from "../db.server";
import { authenticateAdminOrFallback } from "../shopify.server";
import { normalizeShopDomain } from "../services/shop.service.server";
import { resolveShopUser } from "../services/authorization.server";
import { createIncident, listIncidentsForShop, resolveIncidentAndCloseTickets } from "../services/incident.service.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticateAdminOrFallback(request);
  const shop = await db.shop.findUnique({ where: { domain: normalizeShopDomain(session.shop) } });
  if (!shop) throw new Response("Shop not found", { status: 404 });
  const incidents = await listIncidentsForShop(shop.id);
  return {
    shopName: shop.name,
    incidents: incidents.map((inc) => ({
      id: inc.id, title: inc.title, description: inc.description,
      status: inc.status, keywords: inc.keywords,
      ticketCount: inc.tickets.length,
      createdAt: inc.createdAt.toISOString(),
      resolvedAt: inc.resolvedAt?.toISOString() ?? null,
    })),
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticateAdminOrFallback(request);
  const formData = await request.formData();
  const intent = String(formData.get("intent") ?? "").trim();
  const shop = await db.shop.findUnique({ where: { domain: normalizeShopDomain(session.shop) } });
  if (!shop) throw new Response("Shop not found", { status: 404 });
  const email = session.onlineAccessInfo?.associated_user?.email?.trim().toLowerCase();
  const user = await resolveShopUser({ shopId: shop.id, email });
  if (!user) throw new Response("No user found", { status: 403 });

  if (intent === "create-incident") {
    const title = String(formData.get("title") ?? "").trim();
    const description = String(formData.get("description") ?? "").trim();
    const keywords = String(formData.get("keywords") ?? "").split(",").map((k) => k.trim()).filter(Boolean);
    if (title) await createIncident({ shopId: shop.id, title, description, keywords, actorUserId: user.id });
  } else if (intent === "resolve-incident") {
    const incidentId = String(formData.get("incidentId") ?? "").trim();
    const resolutionNote = String(formData.get("resolutionNote") ?? "Issue resolved").trim();
    if (incidentId) await resolveIncidentAndCloseTickets({ incidentId, shopId: shop.id, resolutionNote, actorUserId: user.id });
  }
  return redirect("/app/incidents");
};

export default function IncidentsPage() {
  const data = useLoaderData<typeof loader>();
  const active = data.incidents.filter((i) => i.status !== "RESOLVED");
  const resolved = data.incidents.filter((i) => i.status === "RESOLVED");

  return (
    <div style={{ fontFamily: "Inter, system-ui, sans-serif", maxWidth: 900, margin: "0 auto", padding: "32px 24px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
        <span style={{ fontSize: 28 }}>🚨</span>
        <h1 style={{ margin: 0, fontSize: 24, fontWeight: 700, color: "#111827" }}>Incident Mode</h1>
      </div>
      <p style={{ margin: "0 0 32px", color: "#6b7280", fontSize: 14 }}>
        {data.shopName} · Declare a major incident to group affected tickets and bulk-resolve them
      </p>

      {/* Declare Incident */}
      <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 12, padding: 24, marginBottom: 24 }}>
        <h2 style={{ margin: "0 0 20px", fontSize: 16, fontWeight: 600, color: "#111827" }}>Declare New Incident</h2>
        <Form method="post">
          <input type="hidden" name="intent" value="create-incident" />
          <div style={{ marginBottom: 14 }}>
            <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: "#374151", marginBottom: 5 }}>Incident Title</label>
            <input name="title" placeholder="e.g. Payment Gateway Outage" style={{ width: "100%", padding: "9px 12px", fontSize: 14, border: "1px solid #d1d5db", borderRadius: 8, boxSizing: "border-box", fontFamily: "inherit" }} />
          </div>
          <div style={{ marginBottom: 14 }}>
            <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: "#374151", marginBottom: 5 }}>Internal Description</label>
            <textarea name="description" rows={2} placeholder="Brief description for your team..." style={{ width: "100%", padding: "9px 12px", fontSize: 14, border: "1px solid #d1d5db", borderRadius: 8, boxSizing: "border-box", fontFamily: "inherit", resize: "vertical" }} />
          </div>
          <div style={{ marginBottom: 20 }}>
            <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: "#374151", marginBottom: 5 }}>Auto-match Keywords (comma separated)</label>
            <input name="keywords" placeholder="checkout, payment, error 500, can't pay" style={{ width: "100%", padding: "9px 12px", fontSize: 14, border: "1px solid #d1d5db", borderRadius: 8, boxSizing: "border-box", fontFamily: "inherit" }} />
          </div>
          <button type="submit" style={{ padding: "10px 20px", background: "#dc2626", color: "#fff", border: "none", borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: "pointer" }}>
            🚨 Declare Incident &amp; Auto-Group Tickets
          </button>
        </Form>
      </div>

      {/* Active Incidents */}
      {active.length > 0 && (
        <div style={{ background: "#fff", border: "1px solid #fca5a5", borderRadius: 12, padding: 24, marginBottom: 24 }}>
          <h2 style={{ margin: "0 0 16px", fontSize: 16, fontWeight: 600, color: "#dc2626" }}>🔴 Active Incidents ({active.length})</h2>
          {active.map((inc) => (
            <div key={inc.id} style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 10, padding: 16, marginBottom: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 700, fontSize: 15, color: "#111827", marginBottom: 6 }}>{inc.title}</div>
                  {inc.description && <div style={{ fontSize: 13, color: "#4b5563", marginBottom: 8 }}>{inc.description}</div>}
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <span style={{ fontSize: 12, background: "#fee2e2", color: "#991b1b", padding: "2px 10px", borderRadius: 20, fontWeight: 600 }}>
                      {inc.ticketCount} tickets linked
                    </span>
                    {inc.keywords.map((kw) => (
                      <span key={kw} style={{ fontSize: 12, background: "#f3f4f6", color: "#374151", padding: "2px 8px", borderRadius: 6 }}>#{kw}</span>
                    ))}
                  </div>
                </div>
                <Form method="post" style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                  <input type="hidden" name="intent" value="resolve-incident" />
                  <input type="hidden" name="incidentId" value={inc.id} />
                  <input type="text" name="resolutionNote" placeholder="Resolution note..." style={{ padding: "7px 10px", fontSize: 13, border: "1px solid #d1d5db", borderRadius: 6, width: 200, fontFamily: "inherit" }} />
                  <button type="submit" style={{ padding: "8px 16px", background: "#16a34a", color: "#fff", border: "none", borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" }}>
                    ✓ Resolve &amp; Bulk Close
                  </button>
                </Form>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Resolved */}
      {resolved.length > 0 && (
        <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 12, padding: 24 }}>
          <h2 style={{ margin: "0 0 16px", fontSize: 16, fontWeight: 600, color: "#374151" }}>✅ Resolved Incidents ({resolved.length})</h2>
          {resolved.map((inc) => (
            <div key={inc.id} style={{ padding: "12px 0", borderBottom: "1px solid #f3f4f6", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div>
                <strong style={{ color: "#111827" }}>{inc.title}</strong>
                <span style={{ marginLeft: 8, fontSize: 12, color: "#9ca3af" }}>{inc.ticketCount} tickets · {new Date(inc.resolvedAt ?? inc.createdAt).toLocaleDateString()}</span>
              </div>
              <span style={{ padding: "2px 10px", borderRadius: 20, fontSize: 12, fontWeight: 600, background: "#dcfce7", color: "#15803d" }}>RESOLVED</span>
            </div>
          ))}
        </div>
      )}

      {data.incidents.length === 0 && (
        <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 12, padding: 32, textAlign: "center", color: "#9ca3af" }}>
          No incidents declared. Declare one above to group related support tickets during an outage.
        </div>
      )}
    </div>
  );
}
