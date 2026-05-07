import { mkdir, writeFile } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import { randomBytes } from "node:crypto";

const MAX_MOBILE_UPLOAD_BYTES = 12 * 1024 * 1024;

export interface MobileUploadInput {
  dataBase64: string;
  fileName: string;
  mimeType: string;
}

export interface MobileUploadResult {
  kind: "file" | "image";
  mimeType: string;
  name: string;
  path: string;
  size: number;
}

export async function saveMobileUpload(
  actor: { machineId: string; workspaceId: string },
  input: MobileUploadInput
): Promise<MobileUploadResult> {
  const bytes = Buffer.from(input.dataBase64, "base64");
  if (bytes.length === 0) {
    throw new Error("Attachment is empty");
  }

  if (bytes.length > MAX_MOBILE_UPLOAD_BYTES) {
    throw new Error("Attachment is too large");
  }

  const name = safeFileName(input.fileName);
  const directory = join(
    process.cwd(),
    ".data",
    "mobile-uploads",
    actor.workspaceId,
    actor.machineId
  );
  const filePath = join(directory, `${Date.now()}-${randomBytes(4).toString("hex")}-${name}`);
  await mkdir(directory, { recursive: true });
  await writeFile(filePath, bytes);

  return {
    kind: input.mimeType.toLowerCase().startsWith("image/") ? "image" : "file",
    mimeType: input.mimeType,
    name,
    path: filePath,
    size: bytes.length
  };
}

function safeFileName(fileName: string) {
  const fallback = "attachment";
  const rawBaseName = basename(fileName.trim()) || fallback;
  const extension = extname(rawBaseName).slice(0, 16);
  const stem = rawBaseName.slice(0, rawBaseName.length - extension.length);
  const safeStem = stem.replace(/[^a-zA-Z0-9._-]+/gu, "-").replace(/^-+|-+$/gu, "");
  const safeExtension = extension.replace(/[^a-zA-Z0-9.]+/gu, "");

  return `${safeStem || fallback}${safeExtension}`.slice(0, 180);
}
