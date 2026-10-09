import { useEffect, useState } from "react";
import { Form, useActionData, useLoaderData, useLocation, useNavigation, useSearchParams } from "react-router";
import type { TicketStatus } from "@prisma/client";
import type { TicketActionError, TicketPageData, TicketUpdateKind } from "../services/ticket-page.server";

// Mirrors the Prisma enum; a runtime import of @prisma/client would pull Prisma into the browser bundle.
const TICKET_STATUSES: TicketStatus[] = ["NEW", "OPEN", "WAITING_FOR_CUSTOMER", "WAITING_FOR_AGENT", "RESOLVED", "CLOSED"];

function describeUpdates(updated: string, ticket: TicketPageData) {
  if (updated === "none") return null;
  const labels: Record<TicketUpdateKind, string> = {
    reply: "reply sent",
    note: "internal note added",
    status: `status set to ${ticket.status}`,
    priority: `priority set to ${ticket.priority}`,
    assignee: ticket.assignee ? `assigned to ${ticket.assignee.name ?? ticket.assignee.email}` : "unassigned",
  };
  const parts = updated
    .split(",")
    .map((kind) => labels[kind as TicketUpdateKind])
    .filter(Boolean);
  return parts.length ? parts.join(", ") : null;
}

// Confirms the last save, using the `?updated=` param set by handleTicketPageAction.
function UpdateNotice({ ticket }: { ticket: TicketPageData }) {
  const [searchParams] = useSearchParams();
  const location = useLocation();
  const [dismissedKey, setDismissedKey] = useState<string | null>(null);
  const updated = searchParams.get("updated");

  useEffect(() => {
    if (!updated) return;
    const timer = setTimeout(() => setDismissedKey(location.key), 5000);
    return () => clearTimeout(timer);
  }, [updated, location.key]);

  if (!updated || dismissedKey === location.key) return null;

  const summary = describeUpdates(updated, ticket);
  const success = summary !== null;

  return (
    <div
      role="status"
      style={{
        position: "fixed",
        top: "16px",
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 1000,
        display: "flex",
        alignItems: "center",
        gap: "12px",
        maxWidth: "calc(100% - 32px)",
        padding: "10px 16px",
        fontSize: "13px",
        fontWeight: 600,
        borderRadius: "8px",
        boxShadow: "0 4px 16px rgba(0,0,0,0.12)",
        backgroundColor: success ? "#dcfce7" : "#f1f5f9",
        color: success ? "#166534" : "#475569",
        border: `1px solid ${success ? "#86efac" : "#cbd5e1"}`,
      }}
    >
      <span>{success ? `✓ Ticket updated: ${summary}` : "No changes to save."}</span>
      <button
        type="button"
        aria-label="Dismiss"
        onClick={() => setDismissedKey(location.key)}
        style={{ background: "none", border: "none", cursor: "pointer", fontSize: "16px", lineHeight: 1, color: "inherit" }}
      >
        ×
      </button>
    </div>
  );
}

export function TicketPage() {
  const ticket = useLoaderData<TicketPageData>();
  const actionData = useActionData<TicketActionError | undefined>();
  const navigation = useNavigation();
  const isSavingProperties = navigation.state !== "idle" && navigation.formData?.has("priority") === true;

  const statusColors: Record<string, { bg: string; text: string }> = {
    NEW: { bg: "#dbeafe", text: "#1e40af" },
    OPEN: { bg: "#dcfce7", text: "#166534" },
    WAITING_FOR_CUSTOMER: { bg: "#fef9c3", text: "#854d0e" },
    WAITING_FOR_AGENT: { bg: "#ffedd5", text: "#9a3412" },
    RESOLVED: { bg: "#f3e8ff", text: "#6b21a8" },
    CLOSED: { bg: "#f3f4f6", text: "#374151" },
  };

  const priorityColors: Record<string, { bg: string; text: string }> = {
    LOW: { bg: "#f3f4f6", text: "#4b5563" },
    NORMAL: { bg: "#e0f2fe", text: "#0369a1" },
    HIGH: { bg: "#ffedd5", text: "#c2410c" },
    URGENT: { bg: "#fee2e2", text: "#b91c1c" },
  };

  const currentStatusStyle = statusColors[ticket.status] || { bg: "#f3f4f6", text: "#374151" };
  const currentPriorityStyle = priorityColors[ticket.priority] || { bg: "#f3f4f6", text: "#374151" };

  return (
    <div
      style={{
        fontFamily: "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
        minHeight: "100vh",
        backgroundColor: "#f4f5f7",
        color: "#172b4d",
        padding: "24px 32px",
      }}
    >
      <UpdateNotice ticket={ticket} />
      {actionData?.sendError ? (
        <div
          role="alert"
          style={{
            maxWidth: "1280px",
            margin: "0 auto 16px",
            padding: "12px 16px",
            fontSize: "14px",
            fontWeight: 600,
            borderRadius: "8px",
            backgroundColor: "#fee2e2",
            color: "#991b1b",
            border: "1px solid #fca5a5",
          }}
        >
          {actionData.sendError}
        </div>
      ) : null}
      <div style={{ maxWidth: "1280px", margin: "0 auto" }}>
        <div style={{ marginBottom: "20px" }}>
          <div style={{ marginBottom: "12px" }}>
            <a
              href={ticket.backPath}
              style={{
                fontSize: "13px",
                color: "#475569",
                textDecoration: "none",
                fontWeight: 600,
                display: "inline-flex",
                alignItems: "center",
                gap: "6px",
              }}
            >
              ← Back to Portal Dashboard
            </a>
          </div>

          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "flex-start",
              backgroundColor: "#ffffff",
              padding: "20px 24px",
              borderRadius: "12px",
              boxShadow: "0 2px 8px rgba(0,0,0,0.04)",
            }}
          >
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "6px" }}>
                <span style={{ fontSize: "14px", fontWeight: 700, color: "#64748b" }}>
                  {ticket.ticketNumber}
                </span>
                <span
                  style={{
                    padding: "3px 10px",
                    fontSize: "12px",
                    fontWeight: 700,
                    borderRadius: "12px",
                    backgroundColor: currentStatusStyle.bg,
                    color: currentStatusStyle.text,
                  }}
                >
                  {ticket.status}
                </span>
                <span
                  style={{
                    padding: "3px 10px",
                    fontSize: "12px",
                    fontWeight: 700,
                    borderRadius: "12px",
                    backgroundColor: currentPriorityStyle.bg,
                    color: currentPriorityStyle.text,
                  }}
                >
                  {ticket.priority}
                </span>
                <span style={{ fontSize: "12px", color: "#94a3b8" }}>Source: {ticket.source}</span>
              </div>
              <h1 style={{ fontSize: "22px", fontWeight: 700, margin: 0, color: "#0f172a" }}>
                {ticket.subject}
              </h1>
            </div>

            <div style={{ display: "flex", gap: "12px", alignItems: "center" }}>
              <Form method="post">
                <input type="hidden" name="intent" value={ticket.isFollowing ? "unfollow" : "follow"} />
                <button
                  type="submit"
                  style={{
                    padding: "8px 16px",
                    fontSize: "13px",
                    fontWeight: 600,
                    borderRadius: "8px",
                    border: "1px solid #cbd5e1",
                    backgroundColor: ticket.isFollowing ? "#eff6ff" : "#ffffff",
                    color: ticket.isFollowing ? "#1d4ed8" : "#475569",
                    cursor: "pointer",
                  }}
                >
                  {ticket.isFollowing ? "★ Following" : "☆ Follow ticket"}
                </button>
              </Form>
            </div>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 340px", gap: "24px", alignItems: "start" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
            <div
              style={{
                backgroundColor: "#ffffff",
                padding: "24px",
                borderRadius: "12px",
                boxShadow: "0 2px 8px rgba(0,0,0,0.04)",
              }}
            >
              <h2 style={{ fontSize: "16px", fontWeight: 700, margin: "0 0 20px 0", color: "#0f172a" }}>
                Conversation Thread ({ticket.messages.length})
              </h2>

              {ticket.messages.length === 0 ? (
                <div style={{ padding: "24px", textAlign: "center", color: "#64748b", fontSize: "14px" }}>
                  No customer messages in this thread yet.
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                  {ticket.messages.map((msg: {
                    id: string;
                    body: string;
                    senderType: string;
                    isIncoming: boolean;
                    createdAt: string;
                  }) => (
                    <div
                      key={msg.id}
                      style={{
                        padding: "16px 20px",
                        borderRadius: "12px",
                        backgroundColor: msg.isIncoming ? "#f8fafc" : "#eff6ff",
                        border: msg.isIncoming ? "1px solid #e2e8f0" : "1px solid #bfdbfe",
                        alignSelf: msg.isIncoming ? "flex-start" : "flex-end",
                        width: "90%",
                      }}
                    >
                      <div
                        style={{
                          display: "flex",
                          justifyContent: "space-between",
                          fontSize: "12px",
                          fontWeight: 600,
                          color: msg.isIncoming ? "#475569" : "#1e40af",
                          marginBottom: "8px",
                        }}
                      >
                        <span>
                          {msg.isIncoming ? "👤 Customer" : "👨‍💼 Support Agent"} · {msg.senderType}
                        </span>
                        <span>{new Date(msg.createdAt).toLocaleString()}</span>
                      </div>
                      <div style={{ fontSize: "14px", lineHeight: "1.6", color: "#1e293b", whiteSpace: "pre-wrap" }}>
                        {msg.body}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {ticket.internalNotes.length > 0 ? (
              <div
                style={{
                  backgroundColor: "#fffbeb",
                  border: "1px solid #fde68a",
                  padding: "20px",
                  borderRadius: "12px",
                }}
              >
                <h3 style={{ fontSize: "14px", fontWeight: 700, margin: "0 0 12px 0", color: "#92400e" }}>
                  🔒 Internal Notes ({ticket.internalNotes.length})
                </h3>
                <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                  {ticket.internalNotes.map((note: { id: string; authorName: string; body: string; createdAt: string }) => (
                    <div
                      key={note.id}
                      style={{
                        padding: "12px 16px",
                        backgroundColor: "#ffffff",
                        borderRadius: "8px",
                        border: "1px solid #fef3c7",
                      }}
                    >
                      <div style={{ fontSize: "12px", fontWeight: 600, color: "#78350f", marginBottom: "4px" }}>
                        {note.authorName} · {new Date(note.createdAt).toLocaleString()}
                      </div>
                      <div style={{ fontSize: "14px", color: "#1e293b", whiteSpace: "pre-wrap" }}>{note.body}</div>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            {ticket.aiSuggestion ? (
              <div
                style={{
                  backgroundColor: "#f0fdf4",
                  border: "1.5px solid #86efac",
                  padding: "24px",
                  borderRadius: "12px",
                  boxShadow: "0 4px 16px rgba(16, 185, 129, 0.08)",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <span style={{ fontSize: "18px" }}>✨</span>
                    <h3 style={{ fontSize: "16px", fontWeight: 700, color: "#166534", margin: 0 }}>
                      AI Suggested Reply (Copilot Mode)
                    </h3>
                  </div>
                  <span
                    style={{
                      fontSize: "11px",
                      fontWeight: 700,
                      padding: "3px 8px",
                      backgroundColor: "#dcfce7",
                      color: "#15803d",
                      borderRadius: "6px",
                    }}
                  >
                    Human Review Required
                  </span>
                </div>

                <div
                  style={{
                    backgroundColor: "#ffffff",
                    padding: "16px",
                    borderRadius: "8px",
                    border: "1px solid #bbf7d0",
                    fontSize: "14px",
                    lineHeight: "1.6",
                    color: "#0f172a",
                    whiteSpace: "pre-wrap",
                    marginBottom: "16px",
                  }}
                >
                  {ticket.aiSuggestion}
                </div>

                <Form method="post">
                  <input type="hidden" name="intent" value="approve-ai" />
                  <input type="hidden" name="aiSuggestion" value={ticket.aiSuggestion} />
                  <button
                    type="submit"
                    style={{
                      padding: "10px 20px",
                      fontSize: "14px",
                      fontWeight: 700,
                      backgroundColor: "#16a34a",
                      color: "#ffffff",
                      border: "none",
                      borderRadius: "8px",
                      cursor: "pointer",
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "8px",
                      boxShadow: "0 2px 6px rgba(22, 163, 74, 0.2)",
                    }}
                  >
                    ✨ Approve &amp; Send to Customer
                  </button>
                </Form>
              </div>
            ) : null}

            <div
              style={{
                backgroundColor: "#ffffff",
                padding: "24px",
                borderRadius: "12px",
                boxShadow: "0 2px 8px rgba(0,0,0,0.04)",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
                <h3 style={{ fontSize: "15px", fontWeight: 700, margin: 0, color: "#0f172a" }}>
                  Write Response
                </h3>

                <Form method="post">
                  <input type="hidden" name="intent" value="generate-ai" />
                  <button
                    type="submit"
                    style={{
                      padding: "8px 14px",
                      fontSize: "13px",
                      fontWeight: 600,
                      backgroundColor: "#f1f5f9",
                      color: "#0f172a",
                      border: "1px solid #cbd5e1",
                      borderRadius: "8px",
                      cursor: "pointer",
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "6px",
                    }}
                  >
                    ✨ Generate AI Draft
                  </button>
                </Form>
              </div>

              <Form method="post">
                <div style={{ marginBottom: "16px" }}>
                  <label
                    htmlFor="message"
                    style={{ display: "block", fontSize: "13px", fontWeight: 600, color: "#475569", marginBottom: "6px" }}
                  >
                    Reply to Customer (will be sent via email)
                  </label>
                  <textarea
                    id="message"
                    name="message"
                    rows={4}
                    placeholder="Type your response here..."
                    style={{
                      width: "100%",
                      padding: "12px",
                      fontSize: "14px",
                      border: "1px solid #cbd5e1",
                      borderRadius: "8px",
                      boxSizing: "border-box",
                      outline: "none",
                      fontFamily: "inherit",
                    }}
                  />
                </div>

                {ticket.canManageInternalNotes ? (
                  <div style={{ marginBottom: "16px" }}>
                    <label
                      htmlFor="internalNote"
                      style={{ display: "block", fontSize: "13px", fontWeight: 600, color: "#92400e", marginBottom: "6px" }}
                    >
                      🔒 Internal Note (Only visible to support team)
                    </label>
                    <textarea
                      id="internalNote"
                      name="internalNote"
                      rows={2}
                      placeholder="Add private note for colleagues..."
                      style={{
                        width: "100%",
                        padding: "10px 12px",
                        fontSize: "13px",
                        border: "1px solid #fde68a",
                        backgroundColor: "#fffdf5",
                        borderRadius: "8px",
                        boxSizing: "border-box",
                        outline: "none",
                        fontFamily: "inherit",
                      }}
                    />
                  </div>
                ) : null}

                <div style={{ display: "flex", justifyContent: "flex-end" }}>
                  <button
                    type="submit"
                    style={{
                      padding: "10px 24px",
                      fontSize: "14px",
                      fontWeight: 600,
                      backgroundColor: "#0f172a",
                      color: "#ffffff",
                      border: "none",
                      borderRadius: "8px",
                      cursor: "pointer",
                    }}
                  >
                    Send Reply / Save Changes
                  </button>
                </div>
              </Form>
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
            <div
              style={{
                backgroundColor: "#ffffff",
                padding: "20px",
                borderRadius: "12px",
                boxShadow: "0 2px 8px rgba(0,0,0,0.04)",
              }}
            >
              <h3 style={{ fontSize: "15px", fontWeight: 700, margin: "0 0 16px 0", color: "#0f172a" }}>
                Ticket Properties
              </h3>

              <Form method="post">
                <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
                  <div>
                    <label htmlFor="status" style={{ display: "block", fontSize: "12px", fontWeight: 600, color: "#64748b", marginBottom: "4px" }}>
                      Status
                    </label>
                    <select
                      id="status"
                      name="status"
                      defaultValue={ticket.status}
                      style={{
                        width: "100%",
                        padding: "8px 10px",
                        fontSize: "13px",
                        border: "1px solid #cbd5e1",
                        borderRadius: "6px",
                        backgroundColor: "#ffffff",
                      }}
                    >
                      {TICKET_STATUSES.map((status) => (
                        <option key={status} value={status}>
                          {status}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label htmlFor="assigneeId" style={{ display: "block", fontSize: "12px", fontWeight: 600, color: "#64748b", marginBottom: "4px" }}>
                      Assignee
                    </label>
                    <select
                      id="assigneeId"
                      name="assigneeId"
                      defaultValue={ticket.assignee?.id ?? ""}
                      style={{
                        width: "100%",
                        padding: "8px 10px",
                        fontSize: "13px",
                        border: "1px solid #cbd5e1",
                        borderRadius: "6px",
                        backgroundColor: "#ffffff",
                      }}
                    >
                      <option value="">Unassigned</option>
                      {ticket.agents.map((agent: { id: string; name: string; roleName: string }) => (
                        <option key={agent.id} value={agent.id}>
                          {agent.name} ({agent.roleName})
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label htmlFor="priority" style={{ display: "block", fontSize: "12px", fontWeight: 600, color: "#64748b", marginBottom: "4px" }}>
                      Priority
                    </label>
                    <select
                      id="priority"
                      name="priority"
                      defaultValue={ticket.priority}
                      style={{
                        width: "100%",
                        padding: "8px 10px",
                        fontSize: "13px",
                        border: "1px solid #cbd5e1",
                        borderRadius: "6px",
                        backgroundColor: "#ffffff",
                      }}
                    >
                      {["LOW", "NORMAL", "HIGH", "URGENT"].map((priority) => (
                        <option key={priority} value={priority}>
                          {priority}
                        </option>
                      ))}
                    </select>
                  </div>

                  <button
                    type="submit"
                    disabled={isSavingProperties}
                    style={{
                      marginTop: "4px",
                      padding: "8px 14px",
                      fontSize: "13px",
                      fontWeight: 600,
                      backgroundColor: "#475569",
                      color: "#ffffff",
                      border: "none",
                      borderRadius: "6px",
                      cursor: isSavingProperties ? "wait" : "pointer",
                      opacity: isSavingProperties ? 0.7 : 1,
                    }}
                  >
                    {isSavingProperties ? "Saving…" : "Update Properties"}
                  </button>
                </div>
              </Form>
            </div>

            {ticket.shopifyCustomer ? (
              <div
                style={{
                  backgroundColor: "#ffffff",
                  padding: "20px",
                  borderRadius: "12px",
                  boxShadow: "0 2px 8px rgba(0,0,0,0.04)",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "12px" }}>
                  <span style={{ fontSize: "16px" }}>🛍️</span>
                  <h3 style={{ fontSize: "15px", fontWeight: 700, margin: 0, color: "#0f172a" }}>
                    Shopify Customer
                  </h3>
                </div>

                <div style={{ fontSize: "14px", fontWeight: 600, color: "#0f172a" }}>
                  {[ticket.shopifyCustomer.firstName, ticket.shopifyCustomer.lastName].filter(Boolean).join(" ") ||
                    ticket.shopifyCustomer.email}
                  {ticket.shopifyCustomer.verifiedEmail ? " ✓" : ""}
                </div>

                <div style={{ fontSize: "13px", color: "#64748b", marginTop: "4px" }}>
                  {ticket.shopifyCustomer.email}
                </div>

                <div style={{ marginTop: "12px", paddingTop: "12px", borderTop: "1px solid #f1f5f9", display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
                  <div>
                    <div style={{ fontSize: "11px", color: "#94a3b8", fontWeight: 600 }}>TOTAL ORDERS</div>
                    <div style={{ fontSize: "15px", fontWeight: 700, color: "#0f172a" }}>{ticket.shopifyCustomer.ordersCount}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: "11px", color: "#94a3b8", fontWeight: 600 }}>TOTAL SPENT</div>
                    <div style={{ fontSize: "15px", fontWeight: 700, color: "#059669" }}>{ticket.shopifyCustomer.totalSpent}</div>
                  </div>
                </div>

                {ticket.shopifyCustomer.tags.length > 0 ? (
                  <div style={{ marginTop: "10px", display: "flex", gap: "4px", flexWrap: "wrap" }}>
                    {ticket.shopifyCustomer.tags.map((tag, i) => (
                      <span key={i} style={{ fontSize: "11px", padding: "2px 8px", backgroundColor: "#f1f5f9", borderRadius: "4px", color: "#475569" }}>
                        {tag}
                      </span>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : (
              <div style={{ backgroundColor: "#ffffff", padding: "16px", borderRadius: "12px", fontSize: "13px", color: "#64748b" }}>
                No direct Shopify customer record matched for {ticket.customerEmail}
              </div>
            )}

            {ticket.shopifyOrders.length > 0 ? (
              <div
                style={{
                  backgroundColor: "#ffffff",
                  padding: "20px",
                  borderRadius: "12px",
                  boxShadow: "0 2px 8px rgba(0,0,0,0.04)",
                }}
              >
                <h3 style={{ fontSize: "15px", fontWeight: 700, margin: "0 0 12px 0", color: "#0f172a" }}>
                  Recent Orders ({ticket.shopifyOrders.length})
                </h3>

                <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                  {ticket.shopifyOrders.map((order) => (
                    <div
                      key={order.id}
                      style={{
                        padding: "12px",
                        borderRadius: "8px",
                        backgroundColor: "#f8fafc",
                        border: "1px solid #e2e8f0",
                        fontSize: "13px",
                      }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 700, color: "#0f172a", marginBottom: "4px" }}>
                        <span>{order.name}</span>
                        <span style={{ color: "#059669" }}>{order.totalPrice} {order.currency}</span>
                      </div>
                      <div style={{ fontSize: "12px", color: "#64748b", marginBottom: "6px" }}>
                        {order.financialStatus} · {order.fulfillmentStatus ?? "Unfulfilled"}
                      </div>
                      {order.lineItems.length > 0 ? (
                        <div style={{ fontSize: "12px", color: "#334155" }}>
                          {order.lineItems.map((item, i) => (
                            <div key={i}>
                              {item.quantity}x {item.title}
                            </div>
                          ))}
                        </div>
                      ) : null}
                      {!order.cancelledAt && (
                        <Form method="post" style={{ marginTop: "8px" }}>
                          <input type="hidden" name="intent" value="propose-action" />
                          <input type="hidden" name="actionType" value="cancelOrder" />
                          <input type="hidden" name="actionInput" value={JSON.stringify({ orderName: order.name })} />
                          <button
                            type="submit"
                            style={{ padding: "4px 10px", fontSize: "11px", fontWeight: 600, color: "#dc2626", background: "#fff", border: "1px solid #fca5a5", borderRadius: 6, cursor: "pointer" }}
                          >
                            Propose: Cancel order
                          </button>
                        </Form>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            <div
              style={{
                backgroundColor: "#ffffff",
                padding: "20px",
                borderRadius: "12px",
                boxShadow: "0 2px 8px rgba(0,0,0,0.04)",
              }}
            >
              <h3 style={{ fontSize: "15px", fontWeight: 700, margin: "0 0 8px 0", color: "#0f172a" }}>AI Actions</h3>
              <p style={{ fontSize: "12px", color: "#64748b", margin: "0 0 12px 0" }}>
                Propose any registered action (getOrder, refundOrder, createReturn, etc.). Write actions go through policy guardrails and, unless autopilot is enabled, require approval on the{" "}
                <a href={ticket.actionsPath} style={{ color: "#2563eb" }}>Actions page</a>.
              </p>
              <Form method="post">
                <input type="hidden" name="intent" value="propose-action" />
                <select name="actionType" style={{ width: "100%", padding: "8px 10px", fontSize: "13px", border: "1px solid #cbd5e1", borderRadius: "6px", marginBottom: "8px" }}>
                  {ticket.actionTypes.map((a) => (
                    <option key={a.type} value={a.type}>
                      {a.type} ({a.category})
                    </option>
                  ))}
                </select>
                <textarea
                  name="actionInput"
                  defaultValue={JSON.stringify({ orderName: "#1001" }, null, 2)}
                  rows={4}
                  style={{ width: "100%", padding: "8px 10px", fontSize: "12px", fontFamily: "monospace", border: "1px solid #cbd5e1", borderRadius: "6px", boxSizing: "border-box", marginBottom: "8px" }}
                />
                <button
                  type="submit"
                  style={{ padding: "8px 16px", background: "#0f172a", color: "#fff", border: "none", borderRadius: "6px", fontSize: "13px", fontWeight: 600, cursor: "pointer" }}
                >
                  Propose action
                </button>
              </Form>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
