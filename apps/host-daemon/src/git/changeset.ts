import { defaultRepoRuntime, gitDiff, gitStatus, type RepoRuntime } from "./repo.js";

export interface CollectedChangeSet {
  filesChanged: string[];
  diffText: string;
  summary: string;
}

export async function collectChangeset(
  worktreePath: string,
  runtime?: RepoRuntime
): Promise<CollectedChangeSet> {
  const git = runtime ?? defaultRepoRuntime;
  await git.run("git", ["-C", worktreePath, "add", "-N", "."]);
  const status = await gitStatus(worktreePath, git);
  const diffText = await gitDiff(worktreePath, git);
  const filesChanged = parseChangedFiles(status);

  return {
    filesChanged,
    diffText,
    summary: `Changed ${filesChanged.length} ${filesChanged.length === 1 ? "file" : "files"}.`
  };
}

export function parseChangedFiles(status: string) {
  return status
    .split("\n")
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .map((line) => line.slice(3).trim())
    .filter(Boolean);
}
