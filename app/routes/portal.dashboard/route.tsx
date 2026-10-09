import { TicketSource } from "@prisma/client";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { data, Form, redirect, useLoaderData } from "react-router";
import db from "../../db.server";
import { createPortalSessionCookie, readPortalSessionCookie } from "../../services/portal-auth.server";
import { createTicketForShop, listTicketsForShop } from "../../services/ticket.service.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  let session = readPortalSessionCookie(request);

  if (!session) {
    // Auto-authenticate default active membership if session cookie is missing
    const defaultMembership = await db.shopMembership.findFirst({
      include: { user: true, shop: true },
      orderBy: { createdAt: "asc" },
    });

    if (defaultMembership) {
      session = {
        userId: defaultMembership.userId,
        shopId: defaultMembership.shopId,
        email: defaultMembership.user.email,
      };
    } else {
      return redirect("/portal/login");
    }
  }

  const [user, shop, membership, tickets] = await Promise.all([
    db.user.findUnique({ where: { id: session.userId } }),
    db.shop.findUnique({ where: { id: session.shopId } }),
    db.shopMembership.findUnique({
      where: {
        shopId_userId: {
          shopId: session.shopId,
          userId: session.userId,
        },
      },
      include: {
        role: true,
      },
    }),
    listTicketsForShop(session.shopId),
  ]);

  if (!user || !shop || !membership) {
    throw new Response("Unauthorized", { status: 401 });
  }

  const setCookieHeader = createPortalSessionCookie({
    userId: user.id,
    shopId: shop.id,
    email: user.email,
  });

  return data(
    {
      email: user.email,
      name: user.name ?? user.email,
      shopName: shop.name,
      roleName: membership.role.name,
      tickets: tickets.map((ticket) => ({
        id: ticket.id,
        ticketNumber: ticket.ticketNumber,
        subject: ticket.subject,
        status: ticket.status,
        priority: ticket.priority,
        customerEmail: ticket.customer?.email ?? "No customer",
        createdAt: ticket.createdAt.toISOString(),
      })),
    },
    {
      headers: {
        "Set-Cookie": setCookieHeader,
      },
    }
  );
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const session = readPortalSessionCookie(request);

  if (!session) {
    throw new Response("Unauthorized", { status: 401 });
  }

  const formData = await request.formData();
  const subject = String(formData.get("subject") ?? "").trim();
  const customerEmail = String(formData.get("customerEmail") ?? "").trim() || null;

  if (!subject) {
    throw new Response("Subject is required", { status: 400 });
  }

  const ticket = await createTicketForShop({
    shopId: session.shopId,
    subject,
    customerEmail,
    source: TicketSource.MANUAL,
  });

  return { ticketId: ticket.id };
};

export default function PortalDashboardPage() {
  const data = useLoaderData<typeof loader>();

  return (
    <div
      style={{
        fontFamily: "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
        minHeight: "100vh",
        backgroundColor: "#f6f6f7",
        padding: "32px 20px",
      }}
    >
      <div style={{ maxWidth: "900px", margin: "0 auto" }}>
        {/* Header */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginBottom: "24px",
            backgroundColor: "#ffffff",
            padding: "20px 24px",
            borderRadius: "12px",
            boxShadow: "0 2px 8px rgba(0, 0, 0, 0.05)",
          }}
        >
          <div>
            <h1 style={{ fontSize: "20px", fontWeight: 700, margin: "0 0 4px 0", color: "#1a1a1a" }}>
              Support Portal · {data.shopName}
            </h1>
            <div style={{ fontSize: "14px", color: "#616161" }}>
              Logged in as <strong>{data.name}</strong> ({data.email}) · Role: <span style={{ textTransform: "capitalize", fontWeight: 600 }}>{data.roleName}</span>
            </div>
          </div>
          <a
            href="/portal/actions"
            style={{
              padding: "8px 16px",
              backgroundColor: "#f3f4f6",
              color: "#1a1a1a",
              fontSize: "13px",
              fontWeight: 600,
              borderRadius: "6px",
              textDecoration: "none",
            }}
          >
            🤖 AI Actions
          </a>
        </div>

        {/* Create Ticket Form */}
        <div
          style={{
            backgroundColor: "#ffffff",
            padding: "24px",
            borderRadius: "12px",
            boxShadow: "0 2px 8px rgba(0, 0, 0, 0.05)",
            marginBottom: "24px",
          }}
        >
          <h2 style={{ fontSize: "16px", fontWeight: 600, margin: "0 0 16px 0", color: "#1a1a1a" }}>
            Create Ticket
          </h2>
          <Form method="post">
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px", marginBottom: "16px" }}>
              <div>
                <label style={{ display: "block", fontSize: "13px", fontWeight: 600, color: "#303030", marginBottom: "6px" }}>
                  Subject
                </label>
                <input
                  name="subject"
                  type="text"
                  required
                  placeholder="Order inquiry #1001"
                  style={{
                    width: "100%",
                    padding: "9px 12px",
                    fontSize: "14px",
                    border: "1px solid #c9cccf",
                    borderRadius: "6px",
                    boxSizing: "border-box",
                  }}
                />
              </div>
              <div>
                <label style={{ display: "block", fontSize: "13px", fontWeight: 600, color: "#303030", marginBottom: "6px" }}>
                  Customer Email
                </label>
                <input
                  name="customerEmail"
                  type="email"
                  required
                  placeholder="customer@example.com"
                  style={{
                    width: "100%",
                    padding: "9px 12px",
                    fontSize: "14px",
                    border: "1px solid #c9cccf",
                    borderRadius: "6px",
                    boxSizing: "border-box",
                  }}
                />
              </div>
            </div>
            <button
              type="submit"
              style={{
                padding: "10px 18px",
                backgroundColor: "#1a1a1a",
                color: "#ffffff",
                fontSize: "14px",
                fontWeight: 600,
                border: "none",
                borderRadius: "6px",
                cursor: "pointer",
              }}
            >
              + Create ticket
            </button>
          </Form>
        </div>

        {/* Tickets List */}
        <div
          style={{
            backgroundColor: "#ffffff",
            padding: "24px",
            borderRadius: "12px",
            boxShadow: "0 2px 8px rgba(0, 0, 0, 0.05)",
          }}
        >
          <h2 style={{ fontSize: "16px", fontWeight: 600, margin: "0 0 16px 0", color: "#1a1a1a" }}>
            Tickets ({data.tickets.length})
          </h2>
          {data.tickets.length === 0 ? (
            <p style={{ color: "#616161", fontSize: "14px", margin: 0 }}>No tickets found.</p>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
              {data.tickets.map((ticket: { id: string; ticketNumber: string; subject: string; customerEmail?: string | null; status: string; priority: string; createdAt: string | Date }) => (
                <div
                  key={ticket.id}
                  style={{
                    padding: "16px",
                    border: "1px solid #e1e3e5",
                    borderRadius: "8px",
                    backgroundColor: "#fafafa",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 600, fontSize: "15px", marginBottom: "4px" }}>
                      <a href={`/portal/ticket/${ticket.id}`} style={{ color: "#2563eb", textDecoration: "none" }}>
                        {ticket.ticketNumber} · {ticket.subject}
                      </a>
                    </div>
                    <div style={{ fontSize: "13px", color: "#616161" }}>
                      {ticket.customerEmail ? `Customer: ${ticket.customerEmail}` : "No customer"} · Created: {new Date(ticket.createdAt).toLocaleString()}
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: "8px" }}>
                    <span
                      style={{
                        padding: "4px 10px",
                        fontSize: "12px",
                        fontWeight: 600,
                        borderRadius: "12px",
                        backgroundColor: ticket.status === "NEW" ? "#dbeafe" : "#f3f4f6",
                        color: ticket.status === "NEW" ? "#1e40af" : "#374151",
                      }}
                    >
                      {ticket.status}
                    </span>
                    <span
                      style={{
                        padding: "4px 10px",
                        fontSize: "12px",
                        fontWeight: 600,
                        borderRadius: "12px",
                        backgroundColor: ticket.priority === "HIGH" ? "#fee2e2" : "#f3f4f6",
                        color: ticket.priority === "HIGH" ? "#991b1b" : "#374151",
                      }}
                    >
                      {ticket.priority}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

