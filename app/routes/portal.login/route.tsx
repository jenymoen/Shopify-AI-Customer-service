import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, useActionData, useLoaderData } from "react-router";
import { countRecentMagicLinks, createMagicLinkToken, findLoginTarget } from "../../services/portal-auth.server";
import { sendAuthEmail } from "../../services/auth-email.server";

type LoginResult = {
  email: string;
  success: boolean;
  error: string | null;
  /** Only ever set outside production when no mail provider is configured. */
  magicLinkUrl: string | null;
};

export const loader = async ({ request }: LoaderFunctionArgs): Promise<LoginResult> => {
  const url = new URL(request.url);
  return { email: url.searchParams.get("email") ?? "", success: false, error: null, magicLinkUrl: null };
};

export const action = async ({ request }: ActionFunctionArgs): Promise<LoginResult> => {
  const formData = await request.formData();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();

  if (!email) {
    return { email, success: false, error: "Email is required.", magicLinkUrl: null };
  }

  let magicLinkUrl: string | null = null;

  // The answer is identical whether or not the address is known, so the form cannot be used to
  // find out who has access. A link is only created for members and pending invitations.
  const target = await findLoginTarget(email);
  if (target && (await countRecentMagicLinks(email)) < 3) {
    const { token } = await createMagicLinkToken({
      shopId: target.shopId,
      email,
      name: target.name,
      roleName: target.roleName,
    });

    const link = new URL("/portal/accept", process.env.SHOPIFY_APP_URL || request.url);
    link.search = new URLSearchParams({ email, token, shopId: target.shopId }).toString();

    try {
      await sendAuthEmail({
        kind: "login",
        shopId: target.shopId,
        toEmail: email,
        toName: target.name,
        link: link.toString(),
        expiresInText: "expires in 15 minutes",
      });
    } catch (error) {
      console.error("[auth-email] could not send sign-in link:", error instanceof Error ? error.message : error);
      // Convenience for local development only; production never hands the link to the browser.
      if (process.env.NODE_ENV !== "production") magicLinkUrl = link.toString();
    }
  }

  return { email, success: true, error: null, magicLinkUrl };
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

          {data.success && !data.magicLinkUrl ? (
            <div
              style={{
                padding: "16px",
                backgroundColor: "#f3faf7",
                border: "1px solid #a7f3d0",
                borderRadius: "8px",
                color: "#065f46",
                fontSize: "14px",
                marginBottom: "20px",
              }}
            >
              If {data.email} has access to the portal, a sign-in link is on its way. It is valid for 15 minutes.
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
              <strong>✓ Magic link ready! (development only, no mail provider)</strong>
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

