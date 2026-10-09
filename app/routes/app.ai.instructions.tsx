import { AIInstructionType, PermissionName, Prisma } from "@prisma/client";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, redirect, useLoaderData } from "react-router";
import db from "../db.server";
import { authenticate } from "../shopify.server";
import { normalizeShopDomain } from "../services/shop.service.server";
import { hasPermission, resolveShopUser } from "../services/authorization.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
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

  const canWriteKnowledge = await hasPermission({
    userId: user.id,
    shopId: shop.id,
    permission: PermissionName.KNOWLEDGE_WRITE,
  });

  if (!canWriteKnowledge) {
    throw new Response("Access denied", { status: 403 });
  }

  const instructions = await db.aIInstruction.findMany({
    where: { shopId: shop.id },
    orderBy: { createdAt: "desc" },
  });

  return {
    shopName: shop.name,
    instructions: instructions.map((instruction) => ({
      id: instruction.id,
      name: instruction.name,
      type: instruction.type,
      content: instruction.content,
      isActive: instruction.isActive,
      createdAt: instruction.createdAt.toISOString(),
    })),
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const formData = await request.formData();

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

  const canWriteKnowledge = await hasPermission({
    userId: user.id,
    shopId: shop.id,
    permission: PermissionName.KNOWLEDGE_WRITE,
  });

  if (!canWriteKnowledge) {
    throw new Response("Access denied", { status: 403 });
  }

  const name = String(formData.get("name") ?? "").trim();
  const type = String(formData.get("type") ?? "").trim();
  const content = String(formData.get("content") ?? "").trim();
  const conditionsRaw = String(formData.get("conditions") ?? "").trim();
  const isActive = String(formData.get("isActive") ?? "") === "on";

  if (!name || !type || !content) {
    throw new Response("Name, type and content are required", { status: 400 });
  }

  const allowedTypes = Object.values(AIInstructionType);
  const parsedType = allowedTypes.includes(type as AIInstructionType)
    ? (type as AIInstructionType)
    : null;

  if (!parsedType) {
    throw new Response("Invalid instruction type", { status: 400 });
  }

  let parsedConditions: Record<string, unknown> | undefined;
  if (conditionsRaw) {
    try {
      const parsedValue = JSON.parse(conditionsRaw);
      if (parsedValue && typeof parsedValue === "object" && !Array.isArray(parsedValue)) {
        parsedConditions = parsedValue as Record<string, unknown>;
      }
    } catch {
      throw new Response("Conditions must be valid JSON object syntax", { status: 400 });
    }
  }

  await db.aIInstruction.create({
    data: {
      shopId: shop.id,
      name,
      type: parsedType,
      content,
      isActive,
      conditions: (parsedConditions ?? undefined) as Prisma.InputJsonValue | undefined,
    },
  });

  return redirect("/app/ai/instructions");
};

export default function AiInstructionsPage() {
  const data = useLoaderData<typeof loader>();

  return (
    <s-page heading={`AI instructions · ${data.shopName}`}>
      <Form method="post">
        <s-section heading="Create instruction">
          <s-stack direction="block" gap="base">
            <s-text-field name="name" label="Instruction name" value="" />
            <label htmlFor="type">Type</label>
            <select id="type" name="type" style={{ width: "100%" }}>
              {Object.values(AIInstructionType).map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </select>
            <label htmlFor="content">Instruction content</label>
            <textarea id="content" name="content" rows={6} style={{ width: "100%" }} />
            <label htmlFor="conditions">Conditions (JSON object)</label>
            <textarea id="conditions" name="conditions" rows={4} style={{ width: "100%" }} placeholder='{"category":"returns"}' />
            <label>
              <input type="checkbox" name="isActive" defaultChecked />
              Active
            </label>
            <s-button type="submit">Save instruction</s-button>
          </s-stack>
        </s-section>
      </Form>

      <s-section heading="Existing instructions">
        <s-stack direction="block" gap="base">
          {data.instructions.length === 0 ? (
            <s-paragraph>No instructions created yet.</s-paragraph>
          ) : (
            data.instructions.map((instruction) => (
              <s-box key={instruction.id} padding="base" borderWidth="base" borderRadius="base" background="subdued">
                <div>
                  <strong>{instruction.name}</strong> · {instruction.type}
                </div>
                <div>{instruction.isActive ? "Active" : "Inactive"}</div>
                <div>{instruction.content}</div>
                <div>{new Date(instruction.createdAt).toLocaleString()}</div>
              </s-box>
            ))
          )}
        </s-stack>
      </s-section>
    </s-page>
  );
}
