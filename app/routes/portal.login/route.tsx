import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, useActionData, useLoaderData } from "react-router";
import db from "../../db.server";
import { createMagicLinkToken } from "../../services/portal-auth.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const email = url.searchParams.get("email") ?? "";

  return {
    email,
    success: false,
    error: null as string | null,
    magicLinkUrl: null as string | null,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const formData = await request.formData();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();

  if (!email) {
    return {
      success: false,
      error: "Email is required.",
      magicLinkUrl: null,
    };
  }

  const pendingInvite = await db.invitation.findFirst({
    where: {
      email,
      status: "PENDING",
      expiresAt: {
        gt: new Date(),
      },
    },
    orderBy: {
      createdAt: "desc",
    },
  });

  const { token, invitation } = await createMagicLinkToken({
    shopId: pendingInvite?.shopId,
    email,
    name: pendingInvite?.name ?? email,
  });

  const magicLinkUrl = new URL("/portal/accept", request.url).toString();
  const params = new URLSearchParams({
    email,
    token,
  });

  if (pendingInvite?.shopId) {
    params.set("shopId", pendingInvite.shopId);
  }

  return {
    success: true,
    error: null,
    magicLinkUrl: `${magicLinkUrl}?${params.toString()}`,
    email: invitation.email,
  };
};

export default function PortalLoginPage() {
  const loaderData = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const data = actionData ?? loaderData;

  return (
    <div
      style={{
        fontFamily: "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
        minHeight: "100vh",
        backgroundColor: "#f6f6f7",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "20px",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: "420px",
          backgroundColor: "#ffffff",
          borderRadius: "12px",
          boxShadow: "0 4px 20px rgba(0, 0, 0, 0.08)",
          padding: "32px",
        }}
      >
        <div style={{ marginBottom: "24px", textAlign: "center" }}>
          <h1 style={{ fontSize: "24px", fontWeight: 700, color: "#1a1a1a", margin: "0 0 8px 0" }}>
            Staff Portal Login
          </h1>
          <p style={{ fontSize: "14px", color: "#616161", margin: 0 }}>
            Sign in with magic link to access customer support
          </p>
        </div>

        <Form method="post">
          <div style={{ marginBottom: "20px" }}>
            <label
              htmlFor="email"
              style={{ display: "block", fontSize: "14px", fontWeight: 600, color: "#303030", marginBottom: "6px" }}
            >
              Work Email
            </label>
            <input
              id="email"
              name="email"
              type="email"
              required
              placeholder="agent@store.com"
              defaultValue={data.email || ""}
              style={{
                width: "100%",
                padding: "10px 14px",
                fontSize: "14px",
                border: "1px solid #c9cccf",
                borderRadius: "8px",
                boxSizing: "border-box",
                outline: "none",
              }}
            />
          </div>

          {data.error ? (
            <div
              style={{
                padding: "12px",
                backgroundColor: "#fdeded",
                border: "1px solid #f8b4b4",
                borderRadius: "8px",
                color: "#9b1c1c",
                fontSize: "14px",
                marginBottom: "20px",
              }}
            >
              {data.error}
            </div>
          ) : null}

          {data.success && data.magicLinkUrl ? (
            <div
              style={{
                padding: "16px",
                backgroundColor: "#f3faf7",
                border: "1px solid #a7f3d0",
                borderRadius: "8px",
                color: "#065f46",
                fontSize: "14px",
                marginBottom: "20px",
                wordBreak: "break-all",
              }}
            >
              <strong>✓ Magic link ready!</strong>
              <div style={{ marginTop: "8px" }}>
                <a
                  href={data.magicLinkUrl}
                  style={{
                    display: "inline-block",
                    padding: "8px 16px",
                    backgroundColor: "#059669",
                    color: "#ffffff",
                    borderRadius: "6px",
                    textDecoration: "none",
                    fontWeight: 600,
                  }}
                >
                  Click here to log in →
                </a>
              </div>
            </div>
          ) : null}

          <button
            type="submit"
            style={{
              width: "100%",
              padding: "12px 20px",
              backgroundColor: "#1a1a1a",
              color: "#ffffff",
              fontSize: "15px",
              fontWeight: 600,
              border: "none",
              borderRadius: "8px",
              cursor: "pointer",
            }}
          >
            Send magic link
          </button>
        </Form>
      </div>
    </div>
  );
}

