import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, redirect, useLoaderData } from "react-router";
import db from "../../db.server";
import { readPortalSessionCookie } from "../../services/portal-auth.server";
import { approveAction, listActionHistory, listPendingActions, rejectAction } from "../../services/actions.service.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  let session = readPortalSessionCookie(request);

  if (!session) {
    const defaultMembership = await db.shopMembership.findFirst({ include: { user: true, shop: true }, orderBy: { createdAt: "asc" } });
    if (defaultMembership) {
      session = { userId: defaultMembership.userId, shopId: defaultMembership.shopId, email: defaultMembership.user.email };
    } else {
      return redirect("/portal/login");
    }
  }

  const [shop, pending, history] = await Promise.all([
    db.shop.findUnique({ where: { id: session.shopId }, select: { name: true } }),
    listPendingActions(session.shopId),
    listActionHistory(session.shopId, { limit: 30 }),
  ]);

  if (!shop) throw new Response("Shop not found", { status: 404 });

  const serialize = (execution: Awaited<ReturnType<typeof listPendingActions>>[number]) => ({
    id: execution.id,
    actionType: execution.actionType,
    category: execution.category,
    status: execution.status,
    input: execution.input,
    result: execution.result,
    errorMessage: execution.errorMessage,
    ticket: execution.ticket ? { id: execution.ticket.id, ticketNumber: execution.ticket.ticketNumber, subject: execution.ticket.subject } : null,
    createdAt: execution.createdAt.toISOString(),
  });

  return {
    shopName: shop.name,
    pending: pending.map(serialize),
    history: history.map(serialize),
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const session = readPortalSessionCookie(request);
  if (!session) throw new Response("Unauthorized", { status: 401 });

  const shop = await db.shop.findUnique({ where: { id: session.shopId }, select: { domain: true } });
  if (!shop) throw new Response("Shop not found", { status: 404 });

  const formData = await request.formData();
  const intent = String(formData.get("intent") ?? "");
  const actionExecutionId = String(formData.get("actionExecutionId") ?? "");

  if (intent === "approve") {
    await approveAction({ actionExecutionId, shopId: session.shopId, shopDomain: shop.domain, approverUserId: session.userId });
  } else if (intent === "reject") {
    const reason = String(formData.get("reason") ?? "").trim() || undefined;
    await rejectAction({ actionExecutionId, shopId: session.shopId, rejecterUserId: session.userId, reason });
  }

  return redirect("/portal/actions");
};

const statusColor: Record<string, string> = {
  PROPOSED: "#2563eb",
  PENDING_APPROVAL: "#d97706",
  APPROVED: "#2563eb",
  REJECTED: "#6b7280",
  EXECUTING: "#7c3aed",
  SUCCEEDED: "#16a34a",
  FAILED: "#dc2626",
};

export default function ActionsPage() {
  const data = useLoaderData<typeof loader>();

  return (
    <div style={{ fontFamily: "Inter, system-ui, sans-serif", maxWidth: 1000, margin: "0 auto", padding: "32px 24px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
        <span style={{ fontSize: 28 }}>🤖</span>
        <h1 style={{ margin: 0, fontSize: 24, fontWeight: 700, color: "#111827" }}>AI Actions</h1>
      </div>
      <p style={{ margin: "0 0 24px", color: "#6b7280", fontSize: 14 }}>{data.shopName} · Review and approve AI-proposed actions</p>

      <h2 style={{ fontSize: 16, fontWeight: 700, color: "#111827", margin: "0 0 12px" }}>
        Pending approval ({data.pending.length})
      </h2>
      {data.pending.length === 0 ? (
        <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 12, padding: 24, color: "#9ca3af", fontSize: 14, marginBottom: 32 }}>
          Nothing is waiting for approval.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12, marginBottom: 32 }}>
          {data.pending.map((execution) => (
            <div key={execution.id} style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 12, padding: 16 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 14, color: "#111827" }}>{execution.actionType}</div>
                  {execution.ticket && (
                    <a href={`/portal/ticket/${execution.ticket.id}`} style={{ fontSize: 12, color: "#2563eb", textDecoration: "none" }}>
                      #{execution.ticket.ticketNumber} · {execution.ticket.subject}
                    </a>
                  )}
                  <pre style={{ fontSize: 12, color: "#374151", background: "#f9fafb", padding: 8, borderRadius: 6, marginTop: 8, whiteSpace: "pre-wrap" }}>
                    {JSON.stringify(execution.input, null, 2)}
                  </pre>
                </div>
                <span style={{ padding: "2px 10px", borderRadius: 20, fontSize: 11, fontWeight: 700, background: statusColor[execution.status] + "20", color: statusColor[execution.status] }}>
                  {execution.status.replace(/_/g, " ")}
                </span>
              </div>
              <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                <Form method="post">
                  <input type="hidden" name="intent" value="approve" />
                  <input type="hidden" name="actionExecutionId" value={execution.id} />
                  <button type="submit" style={{ padding: "6px 14px", background: "#16a34a", color: "#fff", border: "none", borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
                    Approve &amp; execute
                  </button>
                </Form>
                <Form method="post">
                  <input type="hidden" name="intent" value="reject" />
                  <input type="hidden" name="actionExecutionId" value={execution.id} />
                  <button type="submit" style={{ padding: "6px 14px", background: "#fff", color: "#dc2626", border: "1px solid #fca5a5", borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: "pointer" }}>
                    Reject
                  </button>
                </Form>
              </div>
            </div>
          ))}
        </div>
      )}

      <h2 style={{ fontSize: 16, fontWeight: 700, color: "#111827", margin: "0 0 12px" }}>Recent history</h2>
      <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 12, overflow: "hidden" }}>
        {data.history.length === 0 ? (
          <div style={{ padding: 24, color: "#9ca3af", fontSize: 14 }}>No actions have been proposed yet.</div>
        ) : (
          data.history.map((execution, idx) => (
            <div
              key={execution.id}
              style={{ padding: "12px 16px", borderBottom: idx < data.history.length - 1 ? "1px solid #f3f4f6" : "none", display: "flex", justifyContent: "space-between", alignItems: "center" }}
            >
              <div>
                <span style={{ fontWeight: 600, fontSize: 13, color: "#111827" }}>{execution.actionType}</span>
                {execution.ticket && <span style={{ fontSize: 12, color: "#6b7280" }}> · #{execution.ticket.ticketNumber}</span>}
                {execution.errorMessage && <div style={{ fontSize: 12, color: "#dc2626", marginTop: 2 }}>{execution.errorMessage}</div>}
              </div>
              <span style={{ padding: "2px 10px", borderRadius: 20, fontSize: 11, fontWeight: 700, background: statusColor[execution.status] + "20", color: statusColor[execution.status] }}>
                {execution.status.replace(/_/g, " ")}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
