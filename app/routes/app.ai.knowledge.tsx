import { PermissionName } from "@prisma/client";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, redirect, useLoaderData } from "react-router";
import db from "../db.server";
import { authenticateAdminOrFallback } from "../shopify.server";
import { normalizeShopDomain } from "../services/shop.service.server";
import { hasPermission, resolveShopUser } from "../services/authorization.server";
import { chunkAndEmbedDocument } from "../services/knowledge.service.server";
import { parseUrlContent, syncShopifyPagesToKnowledge, syncShopifyProductsToKnowledge } from "../services/document-ingestion.service.server";

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

  const canWriteKnowledge = await hasPermission({
    userId: user.id,
    shopId: shop.id,
    permission: PermissionName.KNOWLEDGE_WRITE,
  });

  if (!canWriteKnowledge) {
    throw new Response("Access denied", { status: 403 });
  }

  const documents = await db.knowledgeDocument.findMany({
    where: { shopId: shop.id },
    orderBy: { createdAt: "desc" },
  });

  return {
    shopName: shop.name,
    documents: documents.map((doc) => ({
      id: doc.id,
      title: doc.title,
      sourceType: doc.sourceType,
      sourceUrl: doc.sourceUrl,
      status: doc.status,
      content: doc.content,
      createdAt: doc.createdAt.toISOString(),
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

  if (intent === "create-manual") {
    const title = String(formData.get("title") ?? "").trim();
    const content = String(formData.get("content") ?? "").trim();
    if (title && content) {
      const document = await db.knowledgeDocument.create({
        data: {
          shopId: shop.id,
          title,
          content,
          sourceType: "MANUAL",
          status: "PUBLISHED",
        },
      });
      await chunkAndEmbedDocument(document.id);
    }
  } else if (intent === "ingest-url") {
    const title = String(formData.get("title") ?? "").trim();
    const url = String(formData.get("url") ?? "").trim();
    if (title && url) {
      const parsedContent = await parseUrlContent(url);
      const document = await db.knowledgeDocument.create({
        data: {
          shopId: shop.id,
          title,
          content: parsedContent,
          sourceType: "URL",
          sourceUrl: url,
          status: "PUBLISHED",
        },
      });
      await chunkAndEmbedDocument(document.id);
    }
  } else if (intent === "sync-pages") {
    await syncShopifyPagesToKnowledge(shop.id, shop.domain);
  } else if (intent === "sync-products") {
    await syncShopifyProductsToKnowledge(shop.id, shop.domain);
  } else if (intent === "delete-document") {
    const documentId = String(formData.get("documentId") ?? "").trim();
    if (documentId) {
      await db.knowledgeDocument.delete({ where: { id: documentId } });
    }
  }

  return redirect("/app/ai/knowledge");
};

export default function KnowledgePage() {
  const data = useLoaderData<typeof loader>();

  return (
    <s-page heading={`AI Knowledge Base · ${data.shopName}`}>
      <s-section heading="Shopify Auto-Sync Sources">
        <s-stack direction="inline" gap="base">
          <Form method="post">
            <input type="hidden" name="intent" value="sync-pages" />
            <s-button type="submit">Sync Shopify Pages</s-button>
          </Form>
          <Form method="post">
            <input type="hidden" name="intent" value="sync-products" />
            <s-button type="submit">Sync Shopify Products</s-button>
          </Form>
        </s-stack>
      </s-section>

      <s-section heading="Ingest Web URL / Article">
        <Form method="post">
          <input type="hidden" name="intent" value="ingest-url" />
          <s-stack direction="block" gap="base">
            <s-text-field name="title" label="Document Title (e.g. Return Policy Webpage)" value="" />
            <s-text-field name="url" label="Public URL (e.g. https://mystore.com/policies/returns)" value="" />
            <s-button type="submit">Scrape & Ingest URL</s-button>
          </s-stack>
        </Form>
      </s-section>

      <s-section heading="Add Manual Knowledge Entry">
        <Form method="post">
          <input type="hidden" name="intent" value="create-manual" />
          <s-stack direction="block" gap="base">
            <s-text-field name="title" label="Title" value="" />
            <s-text-area name="content" label="Knowledge Content / FAQ text" value="" rows={5} />
            <s-button type="submit">Save & Index Document</s-button>
          </s-stack>
        </Form>
      </s-section>

      <s-section heading={`Knowledge Documents (${data.documents.length})`}>
        <s-stack direction="block" gap="base">
          {data.documents.length === 0 ? (
            <s-paragraph>No knowledge documents added yet.</s-paragraph>
          ) : (
            data.documents.map((doc) => (
              <s-box key={doc.id} padding="base" borderWidth="base" borderRadius="base" background="subdued">
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div>
                    <strong>{doc.title}</strong> ({doc.sourceType}) · <span style={{ color: "#16a34a" }}>{doc.status}</span>
                    {doc.sourceUrl ? <div><a href={doc.sourceUrl} target="_blank" rel="noreferrer">{doc.sourceUrl}</a></div> : null}
                  </div>
                  <Form method="post">
                    <input type="hidden" name="intent" value="delete-document" />
                    <input type="hidden" name="documentId" value={doc.id} />
                    <s-button type="submit">Delete</s-button>
                  </Form>
                </div>
                <p style={{ fontSize: "13px", color: "#4b5563", marginTop: "8px" }}>
                  {doc.content.slice(0, 180)}...
                </p>
              </s-box>
            ))
          )}
        </s-stack>
      </s-section>
    </s-page>
  );
}
