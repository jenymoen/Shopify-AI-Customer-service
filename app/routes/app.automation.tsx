import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, redirect, useLoaderData } from "react-router";
import db from "../db.server";
import { authenticateAdminOrFallback } from "../shopify.server";
import { normalizeShopDomain } from "../services/shop.service.server";
import { createAutomationRule, listAutomationRules } from "../services/automation-rules.server";
import { listTeamsForShop } from "../services/team.service.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticateAdminOrFallback(request);
  const shop = await db.shop.findUnique({
    where: { domain: normalizeShopDomain(session.shop) },
  });

  if (!shop) throw new Response("Shop not found", { status: 404 });

  const [rules, teams] = await Promise.all([
    listAutomationRules(shop.id),
    listTeamsForShop(shop.id),
  ]);

  return {
    shopName: shop.name,
    rules: rules.map((r) => ({
      id: r.id,
      name: r.name,
      trigger: r.trigger,
      conditions: r.conditions as Record<string, string>,
      actions: r.actions as Record<string, string>,
      isActive: r.isActive,
      createdAt: r.createdAt.toISOString(),
    })),
    teams: teams.map((t) => ({ id: t.id, name: t.name })),
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticateAdminOrFallback(request);
  const formData = await request.formData();
  const intent = String(formData.get("intent") ?? "").trim();

  const shop = await db.shop.findUnique({
    where: { domain: normalizeShopDomain(session.shop) },
  });
  if (!shop) throw new Response("Shop not found", { status: 404 });

  if (intent === "create-rule") {
    const name = String(formData.get("name") ?? "").trim();
    const subjectContains = String(formData.get("subjectContains") ?? "").trim();
    const setPriority = String(formData.get("setPriority") ?? "").trim();
    const assignTeamId = String(formData.get("assignTeamId") ?? "").trim();

    if (name) {
      await createAutomationRule({
        shopId: shop.id,
        name,
        trigger: "TICKET_CREATED",
        conditions: { ...(subjectContains ? { subjectContains } : {}) },
        actions: {
          ...(setPriority ? { setPriority } : {}),
          ...(assignTeamId ? { assignTeamId } : {}),
        },
      });
    }
  } else if (intent === "delete-rule") {
    const ruleId = String(formData.get("ruleId") ?? "").trim();
    if (ruleId) {
      await db.automationRule.delete({ where: { id: ruleId } });
    }
  }

  return redirect("/app/automation");
};

const S = {
  page: { fontFamily: "Inter, system-ui, sans-serif", maxWidth: 900, margin: "0 auto", padding: "32px 24px" } as React.CSSProperties,
  header: { display: "flex", alignItems: "center", gap: 12, marginBottom: 8 } as React.CSSProperties,
  h1: { margin: 0, fontSize: 24, fontWeight: 700, color: "#111827" } as React.CSSProperties,
  subtitle: { margin: "0 0 32px", color: "#6b7280", fontSize: 14 } as React.CSSProperties,
  card: { background: "#fff", border: "1px solid #e5e7eb", borderRadius: 12, padding: 24, marginBottom: 24 } as React.CSSProperties,
  label: { display: "block", fontSize: 13, fontWeight: 600, color: "#374151", marginBottom: 6 } as React.CSSProperties,
  input: { width: "100%", padding: "9px 12px", fontSize: 14, border: "1px solid #d1d5db", borderRadius: 8, boxSizing: "border-box" as const, fontFamily: "inherit", outline: "none" },
  select: { padding: "9px 12px", fontSize: 14, border: "1px solid #d1d5db", borderRadius: 8, background: "#fff", fontFamily: "inherit", cursor: "pointer", outline: "none" } as React.CSSProperties,
  btn: { padding: "9px 20px", background: "#4f46e5", color: "#fff", border: "none", borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: "pointer" } as React.CSSProperties,
  btnDanger: { padding: "6px 14px", background: "#fff", color: "#dc2626", border: "1px solid #fca5a5", borderRadius: 6, fontSize: 13, fontWeight: 500, cursor: "pointer" } as React.CSSProperties,
  ruleCard: { background: "#f9fafb", border: "1px solid #e5e7eb", borderRadius: 10, padding: 16, marginBottom: 12 } as React.CSSProperties,
  badge: { display: "inline-block", padding: "2px 10px", borderRadius: 20, fontSize: 12, fontWeight: 600, background: "#e0e7ff", color: "#4338ca" } as React.CSSProperties,
  chip: { display: "inline-flex", alignItems: "center", gap: 4, padding: "3px 10px", borderRadius: 6, fontSize: 12, background: "#f3f4f6", color: "#374151" } as React.CSSProperties,
};

function humanConditions(cond: Record<string, string>) {
  return Object.entries(cond).map(([k, v]) => {
    if (k === "subjectContains") return `Subject contains "${v}"`;
    return `${k}: ${v}`;
  });
}

function humanActions(act: Record<string, string>, teams: { id: string; name: string }[]) {
  return Object.entries(act).map(([k, v]) => {
    if (k === "setPriority") return `Set priority → ${v}`;
    if (k === "assignTeamId") {
      const team = teams.find((t) => t.id === v);
      return `Assign to team → ${team?.name ?? v}`;
    }
    return `${k}: ${v}`;
  });
}

export default function AutomationPage() {
  const data = useLoaderData<typeof loader>();

  return (
    <div style={S.page}>
      {/* Header */}
      <div style={S.header}>
        <span style={{ fontSize: 28 }}>⚡</span>
        <h1 style={S.h1}>Automation Rules</h1>
      </div>
      <p style={S.subtitle}>{data.shopName} · Auto-route, prioritise, and assign tickets when they arrive</p>

      {/* Create Rule Form */}
      <div style={S.card}>
        <h2 style={{ margin: "0 0 20px", fontSize: 16, fontWeight: 600, color: "#111827" }}>Create New Rule</h2>
        <Form method="post">
          <input type="hidden" name="intent" value="create-rule" />

          <div style={{ marginBottom: 16 }}>
            <label style={S.label}>Rule Name</label>
            <input name="name" placeholder="e.g. Route Urgent Returns to VIP Team" style={S.input} />
          </div>

          <div style={{ marginBottom: 16 }}>
            <label style={S.label}>Condition — Ticket subject contains</label>
            <input name="subjectContains" placeholder="e.g. Urgent, Refund, Cancel" style={S.input} />
          </div>

          <div style={{ display: "flex", gap: 12, marginBottom: 20, flexWrap: "wrap" }}>
            <div style={{ flex: 1, minWidth: 200 }}>
              <label style={S.label}>Action — Set Priority</label>
              <select name="setPriority" style={{ ...S.select, width: "100%" }}>
                <option value="">No priority change</option>
                <option value="URGENT">🔴 Urgent</option>
                <option value="HIGH">🟠 High</option>
                <option value="NORMAL">🟡 Normal</option>
                <option value="LOW">🟢 Low</option>
              </select>
            </div>
            <div style={{ flex: 1, minWidth: 200 }}>
              <label style={S.label}>Action — Assign to Team</label>
              <select name="assignTeamId" style={{ ...S.select, width: "100%" }}>
                <option value="">No team assignment</option>
                {data.teams.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            </div>
          </div>

          <button type="submit" style={S.btn}>+ Create Rule</button>
        </Form>
      </div>

      {/* Rules List */}
      <div style={S.card}>
        <h2 style={{ margin: "0 0 20px", fontSize: 16, fontWeight: 600, color: "#111827" }}>
          Active Rules <span style={{ color: "#9ca3af", fontWeight: 400 }}>({data.rules.length})</span>
        </h2>

        {data.rules.length === 0 ? (
          <p style={{ color: "#9ca3af", fontSize: 14, margin: 0 }}>No automation rules yet. Create one above to get started.</p>
        ) : (
          data.rules.map((rule) => {
            const conditions = humanConditions(rule.conditions);
            const actions = humanActions(rule.actions, data.teams);
            return (
              <div key={rule.id} style={S.ruleCard}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
                      <strong style={{ fontSize: 15, color: "#111827" }}>{rule.name}</strong>
                      <span style={S.badge}>{rule.trigger.replace("_", " ")}</span>
                      <span style={{
                        padding: "2px 8px", borderRadius: 20, fontSize: 11, fontWeight: 600,
                        background: rule.isActive ? "#dcfce7" : "#f3f4f6",
                        color: rule.isActive ? "#16a34a" : "#9ca3af",
                      }}>
                        {rule.isActive ? "ACTIVE" : "INACTIVE"}
                      </span>
                    </div>

                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
                      <span style={{ fontSize: 12, color: "#6b7280", fontWeight: 600 }}>IF</span>
                      {conditions.length > 0 ? conditions.map((c, i) => (
                        <span key={i} style={{ ...S.chip, background: "#eff6ff", color: "#1d4ed8" }}>🔍 {c}</span>
                      )) : <span style={S.chip}>Any ticket</span>}
                    </div>

                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      <span style={{ fontSize: 12, color: "#6b7280", fontWeight: 600 }}>THEN</span>
                      {actions.length > 0 ? actions.map((a, i) => (
                        <span key={i} style={{ ...S.chip, background: "#f0fdf4", color: "#15803d" }}>✓ {a}</span>
                      )) : <span style={S.chip}>No actions</span>}
                    </div>
                  </div>

                  <Form method="post" style={{ marginLeft: 16 }}>
                    <input type="hidden" name="intent" value="delete-rule" />
                    <input type="hidden" name="ruleId" value={rule.id} />
                    <button type="submit" style={S.btnDanger}>Delete</button>
                  </Form>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
