import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, redirect, useLoaderData } from "react-router";
import { ActionCategory, PermissionName } from "@prisma/client";
import db from "../db.server";
import { authenticateAdminOrFallback } from "../shopify.server";
import { normalizeShopDomain } from "../services/shop.service.server";
import { hasPermission, resolveShopUser } from "../services/authorization.server";
import { listActionPolicies, updateActionPolicy } from "../services/actions.service.server";

async function requireActionsApproveUser(request: Request) {
  const { session } = await authenticateAdminOrFallback(request);
  const shop = await db.shop.findUnique({ where: { domain: normalizeShopDomain(session.shop) } });
  if (!shop) throw new Response("Shop not found", { status: 404 });

  const email = session.onlineAccessInfo?.associated_user?.email?.trim().toLowerCase();
  const user = await resolveShopUser({ shopId: shop.id, email });
  if (!user) throw new Response("Access denied", { status: 403 });

  const canManageActionPolicies = await hasPermission({
    userId: user.id,
    shopId: shop.id,
    permission: PermissionName.ACTIONS_APPROVE,
  });
  if (!canManageActionPolicies) throw new Response("Access denied", { status: 403 });

  return { shop, user };
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { shop } = await requireActionsApproveUser(request);

  const policies = await listActionPolicies(shop.id);

  return {
    shopName: shop.name,
    policies: policies.map((p) => ({
      actionType: p.actionType,
      category: p.category,
      description: p.description,
      isEnabled: p.isEnabled,
      requiresApproval: p.requiresApproval,
      autopilotEnabled: p.autopilotEnabled,
    })),
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticateAdminOrFallback(request);
  const shop = await db.shop.findUnique({ where: { domain: normalizeShopDomain(session.shop) } });
  if (!shop) throw new Response("Shop not found", { status: 404 });

  const formData = await request.formData();
  const actionType = String(formData.get("actionType") ?? "").trim();
  if (!actionType) return redirect("/app/action-policies");

  await updateActionPolicy({
    shopId: shop.id,
    actionType,
    isEnabled: formData.get("isEnabled") === "on",
    requiresApproval: formData.get("requiresApproval") === "on",
    autopilotEnabled: formData.get("autopilotEnabled") === "on",
  });

  return redirect("/app/action-policies");
};

const S = {
  page: { fontFamily: "Inter, system-ui, sans-serif", maxWidth: 900, margin: "0 auto", padding: "32px 24px" } as React.CSSProperties,
  header: { display: "flex", alignItems: "center", gap: 12, marginBottom: 8 } as React.CSSProperties,
  h1: { margin: 0, fontSize: 24, fontWeight: 700, color: "#111827" } as React.CSSProperties,
  subtitle: { margin: "0 0 24px", color: "#6b7280", fontSize: 14 } as React.CSSProperties,
  card: { background: "#fff", border: "1px solid #e5e7eb", borderRadius: 12, padding: 20, marginBottom: 14 } as React.CSSProperties,
  badge: { display: "inline-block", padding: "2px 10px", borderRadius: 20, fontSize: 11, fontWeight: 700 } as React.CSSProperties,
  toggleLabel: { display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "#374151", fontWeight: 500 } as React.CSSProperties,
  btn: { padding: "7px 16px", background: "#4f46e5", color: "#fff", border: "none", borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: "pointer" } as React.CSSProperties,
};

export default function ActionPoliciesPage() {
  const data = useLoaderData<typeof loader>();

  return (
    <div style={S.page}>
      <div style={S.header}>
        <span style={{ fontSize: 28 }}>🔐</span>
        <h1 style={S.h1}>AI Action Policies</h1>
      </div>
      <p style={S.subtitle}>
        {data.shopName} · Control which AI actions are allowed, whether they require human approval, and whether autopilot may run them automatically.
      </p>

      {data.policies.map((policy) => (
        <div key={policy.actionType} style={S.card}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontWeight: 700, fontSize: 15, color: "#111827" }}>{policy.actionType}</span>
                <span
                  style={{
                    ...S.badge,
                    background: policy.category === ActionCategory.WRITE ? "#fee2e2" : "#dbeafe",
                    color: policy.category === ActionCategory.WRITE ? "#991b1b" : "#1e40af",
                  }}
                >
                  {policy.category}
                </span>
              </div>
              <p style={{ margin: "4px 0 0", fontSize: 13, color: "#6b7280" }}>{policy.description}</p>
            </div>
          </div>

          <Form method="post" style={{ display: "flex", gap: 20, alignItems: "center", flexWrap: "wrap" }}>
            <input type="hidden" name="actionType" value={policy.actionType} />
            <label style={S.toggleLabel}>
              <input type="checkbox" name="isEnabled" defaultChecked={policy.isEnabled} /> Enabled
            </label>
            {policy.category === ActionCategory.WRITE && (
              <>
                <label style={S.toggleLabel}>
                  <input type="checkbox" name="requiresApproval" defaultChecked={policy.requiresApproval} /> Requires human approval
                </label>
                <label style={S.toggleLabel}>
                  <input type="checkbox" name="autopilotEnabled" defaultChecked={policy.autopilotEnabled} /> Autopilot (skip approval)
                </label>
              </>
            )}
            <button type="submit" style={S.btn}>Save</button>
          </Form>
        </div>
      ))}
    </div>
  );
}
