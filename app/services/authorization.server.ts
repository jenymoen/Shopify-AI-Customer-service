import { PermissionName, RoleName } from "@prisma/client";
import db from "../db.server";

const DEFAULT_PERMISSION_BY_ROLE: Record<RoleName, PermissionName[]> = {
  OWNER: [
    PermissionName.SHOPS_READ,
    PermissionName.SHOPS_WRITE,
    PermissionName.USERS_READ,
    PermissionName.USERS_WRITE,
    PermissionName.TICKETS_READ,
    PermissionName.TICKETS_WRITE,
    PermissionName.TICKETS_ASSIGN,
    PermissionName.TICKETS_TRANSFER,
    PermissionName.TICKETS_INTERNAL_NOTE,
    PermissionName.CUSTOMERS_READ,
    PermissionName.CUSTOMERS_WRITE,
    PermissionName.KNOWLEDGE_READ,
    PermissionName.KNOWLEDGE_WRITE,
    PermissionName.AI_GENERATE,
    PermissionName.AI_VALIDATE,
    PermissionName.ACTIONS_READ,
    PermissionName.ACTIONS_WRITE,
    PermissionName.ACTIONS_APPROVE,
  ],
  ADMIN: [
    PermissionName.SHOPS_READ,
    PermissionName.USERS_READ,
    PermissionName.USERS_WRITE,
    PermissionName.TICKETS_READ,
    PermissionName.TICKETS_WRITE,
    PermissionName.TICKETS_ASSIGN,
    PermissionName.TICKETS_TRANSFER,
    PermissionName.TICKETS_INTERNAL_NOTE,
    PermissionName.CUSTOMERS_READ,
    PermissionName.CUSTOMERS_WRITE,
    PermissionName.KNOWLEDGE_READ,
    PermissionName.KNOWLEDGE_WRITE,
    PermissionName.AI_GENERATE,
    PermissionName.AI_VALIDATE,
    PermissionName.ACTIONS_READ,
    PermissionName.ACTIONS_WRITE,
    PermissionName.ACTIONS_APPROVE,
  ],
  AGENT: [
    PermissionName.TICKETS_READ,
    PermissionName.TICKETS_WRITE,
    PermissionName.TICKETS_ASSIGN,
    PermissionName.TICKETS_TRANSFER,
    PermissionName.TICKETS_INTERNAL_NOTE,
    PermissionName.CUSTOMERS_READ,
    PermissionName.CUSTOMERS_WRITE,
    PermissionName.KNOWLEDGE_READ,
    PermissionName.AI_GENERATE,
    PermissionName.ACTIONS_READ,
    PermissionName.ACTIONS_WRITE,
  ],
  EXTERNAL_AGENT: [
    PermissionName.TICKETS_READ,
    PermissionName.TICKETS_WRITE,
    PermissionName.CUSTOMERS_READ,
    PermissionName.KNOWLEDGE_READ,
    PermissionName.ACTIONS_READ,
  ],
  VIEWER: [
    PermissionName.TICKETS_READ,
    PermissionName.CUSTOMERS_READ,
    PermissionName.KNOWLEDGE_READ,
  ],
};

// Idempotent and additive: inserts any missing default roles, permissions and
// role-permission links in a handful of batched queries. Never removes grants.
export async function ensureDefaultRolesForShop(shopId: string) {
  const roleNames = Object.keys(DEFAULT_PERMISSION_BY_ROLE) as RoleName[];
  const permissionNames = [...new Set(Object.values(DEFAULT_PERMISSION_BY_ROLE).flat())];

  await db.role.createMany({
    data: roleNames.map((name) => ({ shopId, name, description: `${name} access role` })),
    skipDuplicates: true,
  });
  await db.permission.createMany({
    data: permissionNames.map((name) => ({ shopId, name, description: name })),
    skipDuplicates: true,
  });

  const [allRoles, allPermissions] = await Promise.all([
    db.role.findMany({ where: { shopId } }),
    db.permission.findMany({ where: { shopId } }),
  ]);
  const roleByName = Object.fromEntries(allRoles.map((r) => [r.name, r]));
  const permByName = Object.fromEntries(allPermissions.map((p) => [p.name, p]));

  const links = (Object.entries(DEFAULT_PERMISSION_BY_ROLE) as Array<[RoleName, PermissionName[]]>).flatMap(
    ([roleName, permissions]) => {
      const role = roleByName[roleName];
      if (!role) return [];
      return permissions
        .map((permName) => permByName[permName])
        .filter(Boolean)
        .map((perm) => ({ roleId: role.id, permissionId: perm.id }));
    },
  );
  await db.rolePermission.createMany({ data: links, skipDuplicates: true });

  return allRoles;
}

let defaultRolesSync: Promise<void> | undefined;

/**
 * Backfills default roles/permissions for every shop, once per server process.
 * Shops created before a permission was added to DEFAULT_PERMISSION_BY_ROLE
 * would otherwise never receive it.
 */
export function ensureDefaultRolesForAllShops() {
  defaultRolesSync ??= (async () => {
    const shops = await db.shop.findMany({ select: { id: true, domain: true } });
    for (const shop of shops) {
      try {
        await ensureDefaultRolesForShop(shop.id);
      } catch (error) {
        console.error(`Failed to sync default roles for ${shop.domain}`, error);
      }
    }
  })().catch((error) => {
    console.error("Failed to sync default roles", error);
  });
  return defaultRolesSync;
}

export async function ensureUserMembership({
  shopId,
  email,
  name,
  roleName = RoleName.AGENT,
}: {
  shopId: string;
  email: string;
  name?: string | null;
  roleName?: RoleName;
}) {
  const user = await db.user.upsert({
    where: { email },
    update: {
      name: name ?? undefined,
      isActive: true,
      updatedAt: new Date(),
    },
    create: {
      email,
      name: name ?? null,
      isActive: true,
    },
  });

  const role = await db.role.findUnique({
    where: {
      shopId_name: {
        shopId,
        name: roleName,
      },
    },
  });

  if (!role) {
    throw new Error(`Role ${roleName} does not exist for shop ${shopId}`);
  }

  const membership = await db.shopMembership.upsert({
    where: {
      shopId_userId: {
        shopId,
        userId: user.id,
      },
    },
    update: {
      roleId: role.id,
      status: "ACTIVE",
      joinedAt: new Date(),
      updatedAt: new Date(),
    },
    create: {
      shopId,
      userId: user.id,
      roleId: role.id,
      status: "ACTIVE",
      joinedAt: new Date(),
    },
  });

  return { user, membership };
}

/**
 * Resolve the acting user for a shop. Prefers the session user when they are a
 * member; otherwise (offline sessions have no user) falls back to the shop's
 * OWNER, then any active member. Never returns a user from another shop.
 */
export async function resolveShopUser({ shopId, email }: { shopId: string; email?: string | null }) {
  if (email) {
    const membership = await db.shopMembership.findFirst({
      where: { shopId, status: "ACTIVE", user: { email } },
      include: { user: true },
    });
    if (membership) return membership.user;
  }

  const membership =
    (await db.shopMembership.findFirst({
      where: { shopId, status: "ACTIVE", role: { name: RoleName.OWNER } },
      include: { user: true },
    })) ??
    (await db.shopMembership.findFirst({
      where: { shopId, status: "ACTIVE" },
      include: { user: true },
    }));

  return membership?.user ?? null;
}

export async function hasPermission({
  userId,
  shopId,
  permission,
}: {
  userId: string;
  shopId: string;
  permission: PermissionName;
}) {
  const membership = await db.shopMembership.findFirst({
    where: {
      shopId,
      userId,
      status: "ACTIVE",
    },
    include: {
      role: {
        include: {
          permissions: {
            include: {
              permission: true,
            },
          },
        },
      },
    },
  });

  if (!membership) {
    return false;
  }

  return membership.role.permissions.some(
    (rolePermission) => rolePermission.permission.name === permission,
  );
}

export async function getEffectivePermissionsForUser(userId: string, shopId: string) {
  const membership = await db.shopMembership.findFirst({
    where: {
      shopId,
      userId,
      status: "ACTIVE",
    },
    include: {
      role: {
        include: {
          permissions: {
            include: {
              permission: true,
            },
          },
        },
      },
    },
  });

  return membership?.role.permissions.map((rolePermission) => rolePermission.permission.name) ?? [];
}
