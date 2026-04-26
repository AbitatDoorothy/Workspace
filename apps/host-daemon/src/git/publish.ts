import { defaultRepoRuntime, type RepoRuntime } from "./repo.js";

interface CommitAndPushInput {
  worktreePath: string;
  branchName: string;
  commitMessage: string;
  runtime?: RepoRuntime;
}

interface CreatePullRequestInput {
  worktreePath: string;
  branchName: string;
  runtime?: RepoRuntime;
}

export async function commitAndPushWorktree(input: CommitAndPushInput) {
  const runtime = input.runtime ?? defaultRepoRuntime;

  await runtime.run("git", ["-C", input.worktreePath, "add", "."]);
  await runtime.run("git", ["-C", input.worktreePath, "commit", "-m", input.commitMessage]);
  const commitSha = String(
    (await runtime.run("git", ["-C", input.worktreePath, "rev-parse", "HEAD"])) ?? ""
  ).trim();
  await runtime.run("git", ["-C", input.worktreePath, "push", "-u", "origin", input.branchName]);

  return { commitSha };
}

export async function tryCreatePullRequest(input: CreatePullRequestInput) {
  const runtime = input.runtime ?? defaultRepoRuntime;

  try {
    const output = String(
      (await runtime.run("gh", ["pr", "create", "--fill", "--head", input.branchName])) ?? ""
    ).trim();
    const prUrl = output.split(/\s+/).find((token) => /^https?:\/\//.test(token));

    return prUrl ? { prUrl } : { errorMessage: "GitHub CLI did not return a PR URL" };
  } catch (error) {
    return {
      errorMessage: error instanceof Error ? error.message : "GitHub CLI PR creation failed"
    };
  }
}
