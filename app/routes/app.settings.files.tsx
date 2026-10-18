import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, useActionData, useLoaderData, useNavigation } from "react-router";
import { requireShopSettingsAccess } from "../services/settings-access.server";
import {
  MAX_SHARED_FILE_BYTES,
  addSharedFile,
  deleteSharedFile,
  listSharedFiles,
  signedSharedFilePath,
} from "../services/shared-files.server";

export function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const shop = await requireShopSettingsAccess(request);
  const files = await listSharedFiles(shop.id);
  return {
    maxMb: MAX_SHARED_FILE_BYTES / 1024 / 1024,
    files: files.map((f) => ({
      id: f.id,
      filename: f.filename,
      sizeBytes: f.sizeBytes,
      createdAt: f.createdAt.toISOString(),
      downloadUrl: signedSharedFilePath(f.id, shop.id),
    })),
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const shop = await requireShopSettingsAccess(request);
  const formData = await request.formData();

  if (formData.get("intent") === "delete") {
    await deleteSharedFile(shop.id, String(formData.get("id") ?? ""));
    return { ok: true, message: "File deleted." };
  }

  const uploads = formData.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
  if (uploads.length === 0) return { ok: false, message: "Choose at least one file to upload." };

  const errors: string[] = [];
  let added = 0;
  for (const file of uploads) {
    const error = await addSharedFile(shop.id, null, file);
    if (error) errors.push(error);
    else added += 1;
  }

  if (errors.length > 0) {
    return { ok: false, message: `${added > 0 ? `${added} uploaded. ` : ""}${errors.join(" ")}` };
  }
  return { ok: true, message: added === 1 ? "File uploaded." : `${added} files uploaded.` };
};

export default function SharedFilesPage() {
  const { files, maxMb } = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>();
  const isBusy = useNavigation().state !== "idle";

  return (
    <s-page heading="Shared files">
      <s-link slot="breadcrumb-actions" href="/app/settings">Settings</s-link>

      <s-section heading="Upload files">
        <s-paragraph>
          Files uploaded here are shared by the whole team and can be attached to replies on any ticket.
          Max {maxMb} MB per file.
        </s-paragraph>
        {result ? <s-banner tone={result.ok ? "success" : "critical"}>{result.message}</s-banner> : null}
        <Form method="post" encType="multipart/form-data">
          <s-stack direction="block" gap="base">
            <input type="file" name="files" multiple />
            <s-button type="submit" variant="primary" disabled={isBusy || undefined}>
              Upload
            </s-button>
          </s-stack>
        </Form>
      </s-section>

      <s-section heading={`Library (${files.length})`}>
        {files.length === 0 ? (
          <s-paragraph>No files uploaded yet.</s-paragraph>
        ) : (
          <s-stack direction="block" gap="base">
            {files.map((file) => (
              <s-box key={file.id} padding="base" borderWidth="base" borderRadius="base" background="subdued">
                <div>
                  <strong>{file.filename}</strong> · {formatFileSize(file.sizeBytes)} · {new Date(file.createdAt).toLocaleDateString()}
                </div>
                <s-stack direction="inline" gap="small">
                  <s-button href={file.downloadUrl}>Download</s-button>
                  <Form
                    method="post"
                    onSubmit={(event) => {
                      if (!window.confirm(`Delete "${file.filename}"? Replies that already included it will no longer be able to open it here.`)) {
                        event.preventDefault();
                      }
                    }}
                  >
                    <input type="hidden" name="intent" value="delete" />
                    <input type="hidden" name="id" value={file.id} />
                    <s-button type="submit" tone="critical">Delete</s-button>
                  </Form>
                </s-stack>
              </s-box>
            ))}
          </s-stack>
        )}
      </s-section>
    </s-page>
  );
}
