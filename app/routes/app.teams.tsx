import { PermissionName } from "@prisma/client";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, redirect, useLoaderData } from "react-router";
import db from "../db.server";
import { authenticateAdminOrFallback } from "../shopify.server";
import { normalizeShopDomain } from "../services/shop.service.server";
import { hasPermission, resolveShopUser } from "../services/authorization.server";
import { addMemberToTeam, createTeam, listTeamsForShop, removeMemberFromTeam } from "../services/team.service.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticateAdminOrFallback(request);
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

  const canManageTeams = await hasPermission({
    userId: user.id,
    shopId: shop.id,
    permission: PermissionName.USERS_WRITE,
  });

  if (!canManageTeams) {
    throw new Response("Access denied", { status: 403 });
  }

  const [teams, shopMembers] = await Promise.all([
    listTeamsForShop(shop.id),
    db.shopMembership.findMany({
      where: { shopId: shop.id },
      include: { user: true, role: true },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  return {
    shopName: shop.name,
    teams,
    agents: shopMembers.map((m) => ({
      id: m.user.id,
      name: m.user.name ?? m.user.email,
      email: m.user.email,
      role: m.role.name,
    })),
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

  const email = session.onlineAccessInfo?.associated_user?.email?.trim().toLowerCase();
  const user = await resolveShopUser({ shopId: shop.id, email });
  if (!user) throw new Response("Access denied", { status: 403 });

  if (intent === "create-team") {
    const name = String(formData.get("name") ?? "").trim();
    const description = String(formData.get("description") ?? "").trim();

    if (!name) {
      throw new Response("Team name is required", { status: 400 });
    }

    await createTeam({
      shopId: shop.id,
      name,
      description,
      actorUserId: user.id,
    });
  } else if (intent === "add-member") {
    const teamId = String(formData.get("teamId") ?? "").trim();
    const userId = String(formData.get("userId") ?? "").trim();
    const role = String(formData.get("role") ?? "MEMBER").trim();

    if (teamId && userId) {
      await addMemberToTeam({
        teamId,
        userId,
        role,
        actorUserId: user.id,
      });
    }
  } else if (intent === "remove-member") {
    const teamId = String(formData.get("teamId") ?? "").trim();
    const userId = String(formData.get("userId") ?? "").trim();

    if (teamId && userId) {
      await removeMemberFromTeam({
        teamId,
        userId,
        actorUserId: user.id,
      });
    }
  }

  return redirect("/app/teams");
};

export default function TeamsPage() {
  const data = useLoaderData<typeof loader>();

  return (
    <s-page heading={`Teams · ${data.shopName}`}>
      <s-section heading="Create new team">
        <Form method="post">
          <input type="hidden" name="intent" value="create-team" />
          <s-stack direction="block" gap="base">
            <s-text-field name="name" label="Team name (e.g. Tier 1 Support, Shipping & Logistics)" value="" />
            <s-text-field name="description" label="Description (optional)" value="" />
            <s-button type="submit">Create team</s-button>
          </s-stack>
        </Form>
      </s-section>

      <s-section heading="Teams">
        <s-stack direction="block" gap="base">
          {data.teams.length === 0 ? (
            <s-paragraph>No teams created yet.</s-paragraph>
          ) : (
            data.teams.map((team) => (
              <s-box key={team.id} padding="base" borderWidth="base" borderRadius="base" background="subdued">
                <div>
                  <strong>{team.name}</strong> ({team._count.members} members, {team._count.tickets} assigned tickets)
                </div>
                {team.description ? <div>{team.description}</div> : null}

                <div style={{ marginTop: "12px" }}>
                  <strong>Members:</strong>
                  {team.members.length === 0 ? (
                    <div>No members in this team yet.</div>
                  ) : (
                    <div>
                      {team.members.map((m) => (
                        <div key={m.userId} style={{ display: "flex", alignItems: "center", gap: "8px", marginTop: "4px" }}>
                          <span>{m.user.name ?? m.user.email} ({m.role})</span>
                          <Form method="post" style={{ display: "inline" }}>
                            <input type="hidden" name="intent" value="remove-member" />
                            <input type="hidden" name="teamId" value={team.id} />
                            <input type="hidden" name="userId" value={m.userId} />
                            <button type="submit" style={{ fontSize: "11px", cursor: "pointer" }}>Remove</button>
                          </Form>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div style={{ marginTop: "12px" }}>
                  <Form method="post">
                    <input type="hidden" name="intent" value="add-member" />
                    <input type="hidden" name="teamId" value={team.id} />
                    <s-stack direction="inline" gap="base">
                      <select name="userId" style={{ padding: "6px" }}>
                        <option value="">Select agent to add...</option>
                        {data.agents.map((agent) => (
                          <option key={agent.id} value={agent.id}>
                            {agent.name} ({agent.role})
                          </option>
                        ))}
                      </select>
                      <select name="role" style={{ padding: "6px" }}>
                        <option value="MEMBER">Member</option>
                        <option value="LEAD">Team Lead</option>
                      </select>
                      <s-button type="submit">Add to team</s-button>
                    </s-stack>
                  </Form>
                </div>
              </s-box>
            ))
          )}
        </s-stack>
      </s-section>
    </s-page>
  );
}
