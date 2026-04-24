import { resolve, sep } from "node:path";

export function resolveRepoPath(workspaceRoot: string, repoUrl: string) {
  const { owner, repo } = parseGithubRepoUrl(repoUrl);
  const root = resolve(workspaceRoot);
  const repoPath = resolve(root, "repos", "github.com", owner, `${repo}.git-working`);

  if (!repoPath.startsWith(`${root}${sep}`)) {
    throw new Error("Repo path escapes workspace root");
  }

  return repoPath;
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
