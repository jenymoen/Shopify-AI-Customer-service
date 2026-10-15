import { AIInstructionType, PermissionName, Prisma } from "@prisma/client";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, redirect, useActionData, useLoaderData, useSearchParams } from "react-router";
import { AI_INSTRUCTION_TYPES } from "../lib/prisma-enum-values";
import db from "../db.server";
import { authenticate } from "../shopify.server";
import { normalizeShopDomain } from "../services/shop.service.server";
import { hasPermission, resolveShopUser } from "../services/authorization.server";

async function requireKnowledgeWriteAccess(request: Request) {
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

  return shop;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const shop = await requireKnowledgeWriteAccess(request);

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
      conditions: instruction.conditions ? JSON.stringify(instruction.conditions, null, 2) : "",
      createdAt: instruction.createdAt.toISOString(),
    })),
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const shop = await requireKnowledgeWriteAccess(request);
  const formData = await request.formData();
  const intent = String(formData.get("intent") ?? "create");
  const id = String(formData.get("id") ?? "");

  if (intent === "delete" || intent === "toggle") {
    const instruction = await db.aIInstruction.findFirst({ where: { id, shopId: shop.id } });
    if (!instruction) throw new Response("Instruction not found", { status: 404 });

    if (intent === "delete") {
      await db.aIInstruction.delete({ where: { id: instruction.id } });
    } else {
      await db.aIInstruction.update({ where: { id: instruction.id }, data: { isActive: !instruction.isActive } });
    }
    return redirect("/app/ai/instructions");
  }

  const name = String(formData.get("name") ?? "").trim();
  const type = String(formData.get("type") ?? "").trim();
  const content = String(formData.get("content") ?? "").trim();
  const conditionsRaw = String(formData.get("conditions") ?? "").trim();
  const isActive = String(formData.get("isActive") ?? "") === "on";

  if (!name || !type || !content) {
    return { error: "Name, type and content are required." };
  }

  const allowedTypes = Object.values(AIInstructionType);
  const parsedType = allowedTypes.includes(type as AIInstructionType)
    ? (type as AIInstructionType)
    : null;

  if (!parsedType) {
    return { error: "Invalid instruction type." };
  }

  let parsedConditions: Record<string, unknown> | undefined;
  if (conditionsRaw) {
    try {
      const parsedValue = JSON.parse(conditionsRaw);
      if (parsedValue && typeof parsedValue === "object" && !Array.isArray(parsedValue)) {
        parsedConditions = parsedValue as Record<string, unknown>;
      }
    } catch {
      return { error: "Conditions must be a valid JSON object." };
    }
  }

  const data = {
    name,
    type: parsedType,
    content,
    isActive,
    // Editing with an empty conditions field clears them.
    conditions: (parsedConditions ?? Prisma.DbNull) as Prisma.InputJsonValue | typeof Prisma.DbNull,
  };

  try {
    if (intent === "update") {
      const existing = await db.aIInstruction.findFirst({ where: { id, shopId: shop.id } });
      if (!existing) throw new Response("Instruction not found", { status: 404 });
      await db.aIInstruction.update({ where: { id: existing.id }, data });
    } else {
      await db.aIInstruction.create({ data: { shopId: shop.id, ...data } });
    }
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return { error: `An instruction named "${name}" already exists.` };
    }
    throw error;
  }

  return redirect("/app/ai/instructions");
};

export default function AiInstructionsPage() {
  const data = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const [searchParams] = useSearchParams();
  const editing = data.instructions.find((instruction) => instruction.id === searchParams.get("edit")) ?? null;

  return (
    <s-page heading={`AI instructions · ${data.shopName}`}>
      <Form method="post" key={editing?.id ?? "new"}>
        <input type="hidden" name="intent" value={editing ? "update" : "create"} />
        {editing ? <input type="hidden" name="id" value={editing.id} /> : null}
        <s-section heading={editing ? `Edit instruction · ${editing.name}` : "Create instruction"}>
          <s-stack direction="block" gap="base">
            {actionData?.error ? <s-banner tone="critical">{actionData.error}</s-banner> : null}
            <s-text-field name="name" label="Instruction name" value={editing?.name ?? ""} />
            <label htmlFor="type">Type</label>
            <select id="type" name="type" style={{ width: "100%" }} defaultValue={editing?.type}>
              {AI_INSTRUCTION_TYPES.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </select>
            <label htmlFor="content">Instruction content</label>
            <textarea id="content" name="content" rows={6} style={{ width: "100%" }} defaultValue={editing?.content} />
            <label htmlFor="conditions">Conditions (JSON object)</label>
            <textarea
              id="conditions"
              name="conditions"
              rows={4}
              style={{ width: "100%" }}
              placeholder='{"category":"returns"}'
              defaultValue={editing?.conditions}
            />
            <label>
              <input type="checkbox" name="isActive" defaultChecked={editing ? editing.isActive : true} />
              Active
            </label>
            <s-stack direction="inline" gap="small">
              <s-button type="submit" variant="primary">
                {editing ? "Update instruction" : "Save instruction"}
              </s-button>
              {editing ? <s-button href="/app/ai/instructions">Cancel</s-button> : null}
            </s-stack>
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
                <div style={{ whiteSpace: "pre-wrap" }}>{instruction.content}</div>
                <div>{new Date(instruction.createdAt).toLocaleString()}</div>
                <s-stack direction="inline" gap="small">
                  <s-button href={`/app/ai/instructions?edit=${instruction.id}`}>Edit</s-button>
                  <Form method="post">
                    <input type="hidden" name="intent" value="toggle" />
                    <input type="hidden" name="id" value={instruction.id} />
                    <s-button type="submit">{instruction.isActive ? "Deactivate" : "Activate"}</s-button>
                  </Form>
                  <Form
                    method="post"
                    onSubmit={(event) => {
                      if (!window.confirm(`Delete "${instruction.name}"?`)) event.preventDefault();
                    }}
                  >
                    <input type="hidden" name="intent" value="delete" />
                    <input type="hidden" name="id" value={instruction.id} />
                    <s-button type="submit" tone="critical">
                      Delete
                    </s-button>
                  </Form>
                </s-stack>
              </s-box>
            ))
          )}
        </s-stack>
      </s-section>
    </s-page>
  );
}
