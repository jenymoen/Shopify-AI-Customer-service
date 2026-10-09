import { PermissionName } from "@prisma/client";
import type { LoaderFunctionArgs } from "react-router";
import { Link, useLoaderData } from "react-router";
import { authenticateAdminOrFallback } from "../shopify.server";
import db from "../db.server";
import { ensureShopOwnerMembership, normalizeShopDomain } from "../services/shop.service.server";
import { hasPermission, resolveShopUser } from "../services/authorization.server";

const FILTERS = ["all","new","mine","unassigned","waiting","ai_handled","needs_review","high_priority","resolved"] as const;
type InboxFilter = (typeof FILTERS)[number];

function applyFilter(tickets: any[], filter: InboxFilter, userId: string) {
  return tickets.filter((t) => {
    switch (filter) {
      case "new": return t.status === "NEW";
      case "mine": return t.assigneeId === userId;
      case "unassigned": return !t.assigneeId;
      case "waiting": return ["WAITING_FOR_CUSTOMER","WAITING_FOR_AGENT"].includes(t.status);
      case "ai_handled": return t.aiStatus === "RESOLVED" || t.aiStatus === "HANDLED";
      case "needs_review": return t.aiStatus === "PENDING" || t.aiStatus === "REVIEW";
      case "high_priority": return t.priority === "HIGH" || t.priority === "URGENT";
      case "resolved": return ["RESOLVED","CLOSED"].includes(t.status);
      default: return true;
    }
  });
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticateAdminOrFallback(request);
  const shop = await db.shop.findUnique({ where: { domain: normalizeShopDomain(session.shop) } });
  if (!shop) throw new Response("Shop not found", { status: 404 });

  await ensureShopOwnerMembership(shop.id, admin);

  const email = session.onlineAccessInfo?.associated_user?.email?.trim().toLowerCase();
  const user = await resolveShopUser({ shopId: shop.id, email });
  if (!user) throw new Response("Access denied", { status: 403 });

  const canRead = await hasPermission({ userId: user.id, shopId: shop.id, permission: PermissionName.TICKETS_READ });
  if (!canRead) throw new Response("Access denied", { status: 403 });

  const rawFilter = new URL(request.url).searchParams.get("filter") ?? "all";
  const filter: InboxFilter = FILTERS.includes(rawFilter as InboxFilter) ? (rawFilter as InboxFilter) : "all";

  const tickets = await db.ticket.findMany({
    where: { shopId: shop.id },
    orderBy: { createdAt: "desc" },
    include: {
      customer: { select: { email: true, firstName: true, lastName: true } },
      assignee: { select: { id: true, email: true, name: true } },
    },
  });

  const filtered = applyFilter(tickets, filter, user.id);
  const filteredIds = new Set(filtered.map((t: any) => t.id));

  return {
    shopName: shop.name,
    activeFilter: filter,
    allCount: tickets.length,
    tickets: tickets.filter((t) => filteredIds.has(t.id)).map((t) => ({
      id: t.id,
      ticketNumber: t.ticketNumber,
      subject: t.subject,
      status: t.status,
      priority: t.priority,
      aiStatus: t.aiStatus ?? "PENDING",
      slaStatus: t.slaStatus ?? "ON_TIME",
      category: t.category ?? null,
      customerEmail: t.customer?.email ?? null,
      customerName: t.customer ? ([t.customer.firstName, t.customer.lastName].filter(Boolean).join(" ") || t.customer.email) : null,
      assigneeName: t.assignee?.name ?? t.assignee?.email ?? null,
      createdAt: t.createdAt.toISOString(),
    })),
  };
};

const priorityColor: Record<string, string> = {
  URGENT: "#dc2626", HIGH: "#ea580c", NORMAL: "#2563eb", LOW: "#6b7280",
};
const statusColor: Record<string, string> = {
  NEW: "#7c3aed", OPEN: "#2563eb", WAITING_FOR_CUSTOMER: "#d97706",
  WAITING_FOR_AGENT: "#d97706", RESOLVED: "#16a34a", CLOSED: "#6b7280",
};
const FILTER_LABELS: Record<InboxFilter, string> = {
  all: "All", new: "New", mine: "Mine", unassigned: "Unassigned",
  waiting: "Waiting", ai_handled: "AI Handled", needs_review: "Needs Review",
  high_priority: "High Priority", resolved: "Resolved",
};

export default function InboxPage() {
  const data = useLoaderData<typeof loader>();

  return (
    <div style={{ fontFamily: "Inter, system-ui, sans-serif", maxWidth: 1100, margin: "0 auto", padding: "32px 24px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
        <span style={{ fontSize: 28 }}>📥</span>
        <h1 style={{ margin: 0, fontSize: 24, fontWeight: 700, color: "#111827" }}>Inbox</h1>
      </div>
      <p style={{ margin: "0 0 24px", color: "#6b7280", fontSize: 14 }}>{data.shopName} · {data.allCount} total tickets</p>

      {/* Filter tabs */}
      <div style={{ display: "flex", gap: 4, flexWrap: "wrap", marginBottom: 20 }}>
        {FILTERS.map((f) => (
          <a
            key={f}
            href={`?filter=${f}`}
            style={{
              padding: "6px 14px",
              borderRadius: 20,
              fontSize: 13,
              fontWeight: 500,
              textDecoration: "none",
              background: data.activeFilter === f ? "#4f46e5" : "#f3f4f6",
              color: data.activeFilter === f ? "#fff" : "#374151",
              border: "1px solid",
              borderColor: data.activeFilter === f ? "#4f46e5" : "#e5e7eb",
            }}
          >
            {FILTER_LABELS[f]}
          </a>
        ))}
      </div>

      {/* Ticket list */}
      <div style={{ background: "#fff", border: "1px solid #e5e7eb", borderRadius: 12, overflow: "hidden" }}>
        {data.tickets.length === 0 ? (
          <div style={{ padding: 48, textAlign: "center", color: "#9ca3af" }}>
            No tickets match this filter.
          </div>
        ) : (
          data.tickets.map((ticket, idx) => (
            <Link
              key={ticket.id}
              to={`/app/ticket/${ticket.id}`}
              style={{
                display: "block",
                padding: "14px 20px",
                borderBottom: idx < data.tickets.length - 1 ? "1px solid #f3f4f6" : "none",
                textDecoration: "none",
                background: "#fff",
                transition: "background 0.1s",
              }}
              onMouseEnter={e => (e.currentTarget.style.background = "#f9fafb")}
              onMouseLeave={e => (e.currentTarget.style.background = "#fff")}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10, flex: 1, minWidth: 0 }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: "#9ca3af", whiteSpace: "nowrap" }}>#{ticket.ticketNumber}</span>
                  <span style={{ fontWeight: 600, color: "#111827", fontSize: 14, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {ticket.subject}
                  </span>
                </div>
                <div style={{ display: "flex", gap: 6, alignItems: "center", flexShrink: 0, marginLeft: 12 }}>
                  <span style={{ padding: "2px 8px", borderRadius: 20, fontSize: 11, fontWeight: 700, background: statusColor[ticket.status] + "20", color: statusColor[ticket.status] }}>
                    {ticket.status.replace(/_/g, " ")}
                  </span>
                  <span style={{ padding: "2px 8px", borderRadius: 20, fontSize: 11, fontWeight: 700, background: (priorityColor[ticket.priority] ?? "#6b7280") + "20", color: priorityColor[ticket.priority] ?? "#6b7280" }}>
                    {ticket.priority}
                  </span>
                  {ticket.slaStatus !== "ON_TIME" && (
                    <span style={{ padding: "2px 8px", borderRadius: 20, fontSize: 11, fontWeight: 700, background: "#fef3c7", color: "#92400e" }}>
                      SLA {ticket.slaStatus}
                    </span>
                  )}
                </div>
              </div>
              <div style={{ marginTop: 4, display: "flex", gap: 12, fontSize: 12, color: "#6b7280" }}>
                <span>{ticket.customerName ?? ticket.customerEmail ?? "No customer"}</span>
                {ticket.assigneeName ? <span>→ {ticket.assigneeName}</span> : <span style={{ color: "#f59e0b" }}>Unassigned</span>}
                {ticket.category && <span>· {ticket.category}</span>}
                <span>· {new Date(ticket.createdAt).toLocaleDateString()}</span>
              </div>
            </Link>
          ))
        )}
      </div>
    </div>
  );
}
