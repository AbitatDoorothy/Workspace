import { resolve, sep } from "node:path";
import type { ConversationType } from "@abitat/shared";

interface BranchNameInput {
  conversationId: string;
  conversationType: ConversationType;
  prompt: string;
}

export function branchNameForConversation(input: BranchNameInput) {
  const shortId = input.conversationId
    .replace(/^conversation_/, "")
    .slice(0, 8)
    .toLowerCase();
  return `abitat/${input.conversationType}/${shortId}-${slugify(input.prompt)}`;
}

export function resolveRepoPath(workspaceRoot: string, repoUrl: string) {
  const { owner, repo } = parseGithubRepoUrl(repoUrl);
  const root = resolve(workspaceRoot);
  const repoPath = resolve(root, "repos", "github.com", owner, `${repo}.git-working`);

  if (!repoPath.startsWith(`${root}${sep}`)) {
    throw new Error("Repo path escapes workspace root");
  }

  return repoPath;
}

export function resolveWorktreePath(
  workspaceRoot: string,
  conversationId: string,
  branchName: string
) {
  assertSafePathPart(conversationId);
  const root = resolve(workspaceRoot);
  const pathPart = `${conversationId}-${branchName.replace(/[^a-zA-Z0-9._-]+/g, "-")}`;
  const worktreePath = resolve(root, "worktrees", pathPart);

  assertInsideWorkspace(root, worktreePath, "Worktree path escapes workspace root");

  return worktreePath;
}

export function assertInsideWorkspace(
  workspaceRoot: string,
  targetPath: string,
  message = "Path escapes workspace root"
) {
  const root = resolve(workspaceRoot);
  const path = resolve(targetPath);

  if (!path.startsWith(`${root}${sep}`)) {
    throw new Error(message);
  }
}

function parseGithubRepoUrl(repoUrl: string) {
  const ssh = /^git@github\.com:([^/\s]+)\/([^/\s]+?)(?:\.git)?$/.exec(repoUrl);

  if (ssh) {
    return normalizeParts(ssh[1], ssh[2]);
  }

  try {
    const url = new URL(repoUrl);

    if (url.hostname !== "github.com") {
      throw new Error("Invalid GitHub repo URL");
    }

    const [owner, repo] = url.pathname
      .replace(/^\/+/, "")
      .replace(/\.git$/, "")
      .split("/");
    return normalizeParts(owner, repo);
  } catch {
    throw new Error("Invalid GitHub repo URL");
  }
}

function normalizeParts(owner: string | undefined, repo: string | undefined) {
  if (!owner || !repo || owner.includes("..") || repo.includes("..") || repo.includes("/")) {
    throw new Error("Invalid GitHub repo URL");
  }

  return { owner, repo };
}

function assertSafePathPart(value: string) {
  if (!value || value.includes("..") || value.includes("/") || value.includes("\\")) {
    throw new Error("Worktree path escapes workspace root");
  }
}

function slugify(value: string) {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);

  return slug || "task";
}
