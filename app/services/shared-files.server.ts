import crypto from "node:crypto";
import db from "../db.server";
import { appConfig } from "../lib/config.server";

export const MAX_SHARED_FILE_BYTES = 5 * 1024 * 1024;
export const MAX_SHARED_FILES_PER_SHOP = 100;
// Postmark rejects emails above 10 MB in total, so stay below that when attaching several files.
export const MAX_ATTACHED_BYTES_PER_REPLY = 9 * 1024 * 1024;

const BLOCKED_EXTENSIONS = new Set([
  "exe", "bat", "cmd", "com", "msi", "scr", "vbs", "ps1", "sh", "jar", "js", "html", "htm", "svg", "dll", "apk",
]);

const LINK_TTL_SECONDS = 15 * 60;

function sign(fileId: string, shopId: string, expires: number) {
  return crypto
    .createHmac("sha256", appConfig.TOKEN_HASH_SECRET)
    .update(`shared-file:${fileId}:${shopId}:${expires}`)
    .digest("hex");
}

/** Short-lived link for opening a library file from the authenticated settings page. */
export function signedSharedFilePath(fileId: string, shopId: string) {
  const expires = Math.floor(Date.now() / 1000) + LINK_TTL_SECONDS;
  return `/files/shared/${fileId}?${new URLSearchParams({ exp: String(expires), sig: sign(fileId, shopId, expires) })}`;
}

export async function findSharedFileForSignedLink(fileId: string, expires: string | null, signature: string | null) {
  const exp = Number(expires);
  if (!signature || !Number.isFinite(exp) || exp < Date.now() / 1000) return null;

  const file = await db.sharedFile.findUnique({ where: { id: fileId } });
  if (!file) return null;

  const expected = Buffer.from(sign(file.id, file.shopId, exp), "hex");
  const actual = Buffer.from(signature, "hex");
  if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) return null;
  return file;
}

export function listSharedFiles(shopId: string) {
  return db.sharedFile.findMany({
    where: { shopId },
    orderBy: { createdAt: "desc" },
    select: { id: true, filename: true, contentType: true, sizeBytes: true, createdAt: true },
  });
}

/** Validates and stores an uploaded file. Returns an error message, or null on success. */
export async function addSharedFile(shopId: string, userId: string | null, file: File): Promise<string | null> {
  if (!file.name || file.size === 0) return "Choose a file to upload.";
  if (file.size > MAX_SHARED_FILE_BYTES) return `${file.name} is larger than ${MAX_SHARED_FILE_BYTES / 1024 / 1024} MB.`;

  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  if (BLOCKED_EXTENSIONS.has(extension)) return `${file.name}: this file type cannot be uploaded.`;

  if ((await db.sharedFile.count({ where: { shopId } })) >= MAX_SHARED_FILES_PER_SHOP) {
    return `The library is full (${MAX_SHARED_FILES_PER_SHOP} files). Delete some files first.`;
  }

  await db.sharedFile.create({
    data: {
      shopId,
      filename: file.name.slice(0, 200),
      contentType: file.type || "application/octet-stream",
      sizeBytes: file.size,
      data: Buffer.from(await file.arrayBuffer()),
      uploadedByUserId: userId,
    },
  });
  return null;
}

export async function deleteSharedFile(shopId: string, fileId: string) {
  await db.sharedFile.deleteMany({ where: { id: fileId, shopId } });
}

/** Loads the chosen library files (with bytes) for sending. Throws a user-facing Error when the selection is invalid. */
export async function loadFilesForReply(shopId: string, fileIds: string[]) {
  const ids = [...new Set(fileIds)];
  if (ids.length === 0) return [];

  const files = await db.sharedFile.findMany({ where: { shopId, id: { in: ids } } });
  if (files.length !== ids.length) throw new Error("One of the selected files no longer exists.");

  const total = files.reduce((sum, f) => sum + f.sizeBytes, 0);
  if (total > MAX_ATTACHED_BYTES_PER_REPLY) {
    throw new Error(`The selected files are too large to send together (max ${MAX_ATTACHED_BYTES_PER_REPLY / 1024 / 1024} MB in total).`);
  }
  return files;
}
