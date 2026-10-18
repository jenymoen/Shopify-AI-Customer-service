import type { LoaderFunctionArgs } from "react-router";
import { findSharedFileForSignedLink } from "../services/shared-files.server";

// Resource route: downloads one library file. Access is granted by the signed link only.
export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const file = await findSharedFileForSignedLink(
    params.fileId ?? "",
    url.searchParams.get("exp"),
    url.searchParams.get("sig"),
  );
  if (!file) return new Response("This link is invalid or has expired. Reload the page.", { status: 403 });

  const asciiName = file.filename.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return new Response(new Uint8Array(file.data), {
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": `attachment; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(file.filename)}`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, max-age=300",
    },
  });
};
