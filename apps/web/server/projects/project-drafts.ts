import { randomBytes } from "node:crypto";

export const PROJECT_DRAFT_COOKIE_NAME = "abitat_project_draft";
export const PROJECT_DRAFT_COOKIE_MAX_AGE_SECONDS = 10 * 60;

export interface ProjectDraft {
  error?: string;
  hostLocalPath?: string;
  name?: string;
}

interface StoredProjectDraft extends ProjectDraft {
  createdAt: number;
  id: string;
}

interface CreatedProjectDraft {
  cookieValue: string;
  id: string;
}

const draftTtlMs = PROJECT_DRAFT_COOKIE_MAX_AGE_SECONDS * 1000;

export function createProjectDraft(draft: ProjectDraft): CreatedProjectDraft {
  const id = `project_draft_${randomBytes(8).toString("hex")}`;
  const storedDraft = { ...draft, createdAt: Date.now(), id };
  return { cookieValue: encodeProjectDraft(storedDraft), id };
}

export function getProjectDraft(id: string | undefined, cookieValue?: string) {
  if (!id) {
    return undefined;
  }

  const draft = decodeProjectDraft(cookieValue);
  if (!draft || Date.now() - draft.createdAt > draftTtlMs) {
    return undefined;
  }
  if (draft.id !== id) {
    return undefined;
  }

  return {
    error: draft.error,
    hostLocalPath: draft.hostLocalPath,
    name: draft.name
  };
}

function encodeProjectDraft(draft: StoredProjectDraft) {
  return Buffer.from(JSON.stringify(draft)).toString("base64url");
}

function decodeProjectDraft(value: string | undefined) {
  if (!value) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(
      Buffer.from(value, "base64url").toString("utf8")
    ) as Partial<StoredProjectDraft>;

    if (typeof parsed.id !== "string" || typeof parsed.createdAt !== "number") {
      return undefined;
    }

    return {
      createdAt: parsed.createdAt,
      error: stringValue(parsed.error),
      hostLocalPath: stringValue(parsed.hostLocalPath),
      id: parsed.id,
      name: stringValue(parsed.name)
    };
  } catch {
    return undefined;
  }
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : undefined;
}
