import { PermissionName, Prisma } from "@prisma/client";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, useActionData, useLoaderData, useNavigation } from "react-router";
import db from "../db.server";
import { authenticate } from "../shopify.server";
import { normalizeShopDomain } from "../services/shop.service.server";
import { hasPermission, resolveShopUser } from "../services/authorization.server";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function requireShopSettingsAccess(request: Request) {
  const { session } = await authenticate.admin(request);

  const shop = await db.shop.findUnique({
    where: { domain: normalizeShopDomain(session.shop) },
  });

  if (!shop) {
    throw new Response("Shop not found", { status: 404 });
  }

  const email = session.onlineAccessInfo?.associated_user?.email?.trim().toLowerCase();
  const user = await resolveShopUser({ shopId: shop.id, email });
  if (!user) {
    throw new Response("Access denied", { status: 403 });
  }

  const canWriteShop = await hasPermission({
    userId: user.id,
    shopId: shop.id,
    permission: PermissionName.SHOPS_WRITE,
  });

  if (!canWriteShop) {
    throw new Response("Access denied", { status: 403 });
  }

  return shop;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const shop = await requireShopSettingsAccess(request);

  return {
    shopDomain: shop.domain,
    supportEmail: shop.supportEmail ?? "",
    // eslint-disable-next-line no-undef
    inboundAddress: process.env.EMAIL_INBOUND_ADDRESS ?? "",
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const shop = await requireShopSettingsAccess(request);
  const formData = await request.formData();
  const supportEmail = String(formData.get("supportEmail") ?? "").trim().toLowerCase();

  if (supportEmail && !EMAIL_PATTERN.test(supportEmail)) {
    return { ok: false, message: "Enter a valid email address." };
  }

  try {
    await db.shop.update({
      where: { id: shop.id },
      data: { supportEmail: supportEmail || null },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return { ok: false, message: `${supportEmail} is already used by another shop.` };
    }
    throw error;
  }

  return {
    ok: true,
    message: supportEmail ? `Support email set to ${supportEmail}.` : "Support email removed.",
  };
};

export default function EmailSettingsPage() {
  const { shopDomain, supportEmail, inboundAddress } = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>();
  const isSaving = useNavigation().state === "submitting";

  return (
    <s-page heading="Email settings">
      <s-section heading="Support email address">
        <s-paragraph>
          Customer emails sent to this address become tickets for {shopDomain}. Forward the
          address to the inbound address below at your email provider.
        </s-paragraph>

        {result ? (
          <s-banner tone={result.ok ? "success" : "critical"}>{result.message}</s-banner>
        ) : null}

        <Form method="post">
          <s-stack gap="base">
            <s-email-field
              label="Support email"
              name="supportEmail"
              placeholder="support@yourstore.com"
              defaultValue={supportEmail}
            />
            <s-button type="submit" variant="primary" loading={isSaving || undefined}>
              Save
            </s-button>
          </s-stack>
        </Form>
      </s-section>

      <s-section heading="Forward to">
        {inboundAddress ? (
          <s-paragraph>
            <code>{inboundAddress}</code>
          </s-paragraph>
        ) : (
          <s-paragraph>EMAIL_INBOUND_ADDRESS is not configured on the server.</s-paragraph>
        )}
      </s-section>
    </s-page>
  );
}
