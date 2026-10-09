import { PermissionName, RoleName } from "@prisma/client";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, redirect, useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { normalizeShopDomain } from "../services/shop.service.server";
import { createInviteForShop } from "../services/invite.service.server";
import { hasPermission, resolveShopUser } from "../services/authorization.server";
import { logAuditEvent } from "../services/audit.service.server";

const INVITEABLE_ROLES: RoleName[] = [RoleName.ADMIN, RoleName.AGENT, RoleName.EXTERNAL_AGENT, RoleName.VIEWER];

async function requireAdminUser(request: Request) {
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

  const canManageUsers = await hasPermission({
    userId: user.id,
    shopId: shop.id,
    permission: PermissionName.USERS_WRITE,
  });

  if (!canManageUsers) {
    throw new Response("Access denied", { status: 403 });
  }

  return { shop, user, session };
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { shop } = await requireAdminUser(request);

  const pendingInvitations = await db.invitation.findMany({
    where: {
      shopId: shop.id,
      status: "PENDING",
      expiresAt: { gt: new Date() },
    },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      email: true,
      name: true,
      expiresAt: true,
      createdAt: true,
      roleId: true,
    },
  });

  const roleIds = [...new Set(pendingInvitations.map((inv) => inv.roleId).filter(Boolean) as string[])];
  const roles = roleIds.length
    ? await db.role.findMany({ where: { id: { in: roleIds } }, select: { id: true, name: true } })
    : [];
  const roleById = Object.fromEntries(roles.map((r) => [r.id, r.name]));

  return {
    shopName: shop.name,
    pendingInvitations: pendingInvitations.map((inv) => ({
      id: inv.id,
      email: inv.email,
      name: inv.name ?? inv.email,
      role: inv.roleId ? (roleById[inv.roleId] ?? "UNKNOWN") : "UNKNOWN",
      expiresAt: inv.expiresAt?.toISOString() ?? null,
      createdAt: inv.createdAt.toISOString(),
    })),
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, user } = await requireAdminUser(request);
  const formData = await request.formData();
  const intent = String(formData.get("intent") ?? "").trim();

  if (intent === "revoke") {
    const invitationId = String(formData.get("invitationId") ?? "").trim();
    if (invitationId) {
      await db.invitation.updateMany({
        where: { id: invitationId, shopId: shop.id },
        data: { status: "REVOKED" },
      });
      await logAuditEvent({
        shopId: shop.id,
        actorUserId: user.id,
        entityType: "invitation",
        entityId: invitationId,
        eventType: "invitation.revoked",
        details: { invitationId },
      });
    }
    return redirect("/app/invite");
  }

  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const name = String(formData.get("name") ?? "").trim();
  const roleRaw = String(formData.get("role") ?? RoleName.AGENT).trim();
  const expiryDaysRaw = parseInt(String(formData.get("expiryDays") ?? "14"), 10);

  if (!email) {
    throw new Response("Email is required", { status: 400 });
  }

  const roleName = INVITEABLE_ROLES.includes(roleRaw as RoleName)
    ? (roleRaw as RoleName)
    : RoleName.AGENT;

  const expiryDays = isNaN(expiryDaysRaw) || expiryDaysRaw < 1 ? 14 : Math.min(expiryDaysRaw, 90);

  await createInviteForShop({
    shopId: shop.id,
    email,
    name: name || email,
    roleName,
    expiryDays,
    invitedByUserId: user.id,
  });

  await logAuditEvent({
    shopId: shop.id,
    actorUserId: user.id,
    entityType: "invitation",
    entityId: null,
    eventType: "invitation.created",
    details: { email, role: roleName, expiryDays },
  });

  return redirect("/app/invite");
};

export default function InvitePage() {
  const data = useLoaderData<typeof loader>();

  return (
    <s-page heading={`Invite team member · ${data.shopName}`}>
      <Form method="post">
        <input type="hidden" name="intent" value="invite" />
        <s-section heading="Create invite">
          <s-stack direction="block" gap="base">
            <s-text-field name="name" label="Full name" value="" />
            <s-text-field name="email" label="Email" value="" />
            <label htmlFor="role">Role</label>
            <select id="role" name="role" style={{ width: "100%" }}>
              {["AGENT", "ADMIN", "EXTERNAL_AGENT", "VIEWER"].map((role) => (
                <option key={role} value={role}>
                  {role}
                </option>
              ))}
            </select>
            <label htmlFor="expiryDays">Invitation expires in (days)</label>
            <input
              id="expiryDays"
              name="expiryDays"
              type="number"
              min={1}
              max={90}
              defaultValue={14}
              style={{ width: "100%" }}
            />
            <s-button type="submit">Send invite</s-button>
          </s-stack>
        </s-section>
      </Form>

      {data.pendingInvitations.length > 0 ? (
        <s-section heading="Pending invitations">
          <s-stack direction="block" gap="base">
            {data.pendingInvitations.map((inv) => (
              <s-box key={inv.id} padding="base" borderWidth="base" borderRadius="base" background="subdued">
                <div>
                  <strong>{inv.email}</strong> · {inv.name} · {inv.role}
                </div>
                <div>
                  Expires: {inv.expiresAt ? new Date(inv.expiresAt).toLocaleDateString() : "Never"} · Sent:{" "}
                  {new Date(inv.createdAt).toLocaleDateString()}
                </div>
                <Form method="post">
                  <input type="hidden" name="intent" value="revoke" />
                  <input type="hidden" name="invitationId" value={inv.id} />
                  <s-button tone="critical" type="submit">
                    Revoke
                  </s-button>
                </Form>
              </s-box>
            ))}
          </s-stack>
        </s-section>
      ) : (
        <s-section heading="Pending invitations">
          <s-paragraph>No pending invitations.</s-paragraph>
        </s-section>
      )}
    </s-page>
  );
}


