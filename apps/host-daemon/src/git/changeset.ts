import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative } from "node:path";

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
  try {
    await git.run("git", ["-C", worktreePath, "add", "-N", "."]);
    const status = await gitStatus(worktreePath, git);
    const diffText = await gitDiff(worktreePath, git);
    const filesChanged = parseChangedFiles(status);

    return {
      filesChanged,
      diffText,
      summary: summaryFor(filesChanged.length)
    };
  } catch (error) {
    if (!isNotGitRepositoryError(error)) {
      throw error;
    }

    return collectLocalDirectoryChangeset(worktreePath);
  }
}

export function parseChangedFiles(status: string) {
  return status
    .split("\n")
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .map((line) => line.slice(3).trim())
    .filter(Boolean);
}

async function collectLocalDirectoryChangeset(folderPath: string): Promise<CollectedChangeSet> {
  const filesChanged = await listLocalFiles(folderPath);
  const diffText = (
    await Promise.all(
      filesChanged.map(async (file) => {
        const absolutePath = join(folderPath, file);
        const content = await readTextPreview(absolutePath);
        return [`diff --local a/${file} b/${file}`, `+++ b/${file}`, "@@", content].join("\n");
      })
    )
  ).join("\n");

  return {
    filesChanged,
    diffText,
    summary: summaryFor(filesChanged.length)
  };
}

async function listLocalFiles(folderPath: string) {
  const files: string[] = [];
  const entries = await readdir(folderPath, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.name.startsWith(".") || entry.name === "node_modules") {
      continue;
    }

    const absolutePath = join(folderPath, entry.name);

    if (entry.isDirectory()) {
      const nestedFiles = await listLocalFiles(absolutePath);
      files.push(...nestedFiles.map((file) => join(entry.name, file)));
      continue;
    }

    if (entry.isFile()) {
      files.push(relative(folderPath, absolutePath));
    }
  }

  return files.sort();
}

async function readTextPreview(path: string) {
  const details = await stat(path);

  if (details.size > 128 * 1024) {
    return "[file too large to preview]";
  }

  return readFile(path, "utf8").catch(() => "[binary file]");
}

function isNotGitRepositoryError(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  return message.includes("not a git repository");
}

function summaryFor(count: number) {
  return `Changed ${count} ${count === 1 ? "file" : "files"}.`;
}
