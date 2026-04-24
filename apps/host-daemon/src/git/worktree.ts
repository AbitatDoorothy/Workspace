import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { ConversationType } from "@abitat/shared";

import {
  assertInsideWorkspace,
  branchNameForConversation,
  resolveRepoPath,
  resolveWorktreePath
} from "./paths.js";
import {
  addWorktree,
  defaultRepoRuntime,
  fetchRepo,
  gitStatus,
  removeWorktree,
  syncRepo,
  type RepoRuntime
} from "./repo.js";

interface SetupConversationWorktreeInput {
  workspaceRoot: string;
  conversationId: string;
  conversationType: ConversationType;
  prompt: string;
  repoUrl: string;
  defaultBranch: string;
  runtime?: RepoRuntime;
}

interface CleanupConversationWorktreeInput {
  workspaceRoot: string;
  repoPath: string;
  worktreePath: string;
  runtime?: RepoRuntime;
}

export async function setupConversationWorktree(input: SetupConversationWorktreeInput) {
  const runtime = input.runtime ?? defaultRepoRuntime;
  const repoPath = resolveRepoPath(input.workspaceRoot, input.repoUrl);
  const branchName = branchNameForConversation({
    conversationId: input.conversationId,
    conversationType: input.conversationType,
    prompt: input.prompt
  });
  const worktreePath = resolveWorktreePath(input.workspaceRoot, input.conversationId, branchName);

  if (await runtime?.exists(worktreePath)) {
    await gitStatus(worktreePath, runtime);
    return { branchName, repoPath, worktreePath };
  }

  await syncRepo({
    repoUrl: input.repoUrl,
    defaultBranch: input.defaultBranch,
    targetPath: repoPath,
    runtime
  });
  await fetchRepo(repoPath, input.defaultBranch, runtime);
  await mkdir(dirname(worktreePath), { recursive: true });
  await addWorktree(repoPath, worktreePath, branchName, input.defaultBranch, runtime);

  return { branchName, repoPath, worktreePath };
}

export async function cleanupConversationWorktree(input: CleanupConversationWorktreeInput) {
  assertInsideWorkspace(
    input.workspaceRoot,
    input.worktreePath,
    "Worktree path escapes workspace root"
  );
  await removeWorktree(input.repoPath, input.worktreePath, input.runtime);
}
