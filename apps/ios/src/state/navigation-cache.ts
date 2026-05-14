import * as FileSystem from "expo-file-system/legacy";

import type { ConversationSummary, ProjectSummary } from "../types";

export const NAVIGATION_CACHE_DIRECTORY = "navigation-cache";
const NAVIGATION_CACHE_VERSION = 1;
const MAX_CACHED_PROJECTS = 500;
const MAX_CACHED_CONVERSATIONS_PER_PROJECT = 500;

export interface CachedNavigationData {
  conversationsByProject: Record<string, ConversationSummary[]>;
  projects: ProjectSummary[];
}

interface CachedNavigationDataFile extends CachedNavigationData {
  version: typeof NAVIGATION_CACHE_VERSION;
}

export async function loadCachedNavigationData(scope: string): Promise<CachedNavigationData> {
  const path = await navigationCachePath(scope);
  if (!path) {
    return emptyNavigationData();
  }

  try {
    const raw = await FileSystem.readAsStringAsync(path);
    const parsed = JSON.parse(raw) as Partial<CachedNavigationDataFile>;
    if (
      parsed.version !== NAVIGATION_CACHE_VERSION ||
      !Array.isArray(parsed.projects) ||
      !isConversationMap(parsed.conversationsByProject)
    ) {
      return emptyNavigationData();
    }

    return {
      conversationsByProject: prepareCachedConversationsByProject(parsed.conversationsByProject),
      projects: prepareCachedProjects(parsed.projects)
    };
  } catch {
    return emptyNavigationData();
  }
}

export async function saveCachedProjects(scope: string, projects: ProjectSummary[]) {
  const current = await loadCachedNavigationData(scope);
  await saveCachedNavigationData(scope, {
    ...current,
    projects: prepareCachedProjects(projects)
  });
}

export async function saveCachedProjectConversations(
  scope: string,
  projectId: string,
  conversations: ConversationSummary[]
) {
  const current = await loadCachedNavigationData(scope);
  await saveCachedNavigationData(scope, {
    ...current,
    conversationsByProject: {
      ...current.conversationsByProject,
      [projectId]: prepareCachedConversations(conversations)
    }
  });
}

export async function clearCachedNavigationData() {
  const directory = navigationCacheDirectory();
  if (!directory) {
    return;
  }

  await FileSystem.deleteAsync(directory, { idempotent: true });
}

export function prepareCachedProjects(projects: ProjectSummary[]) {
  const byId = new Map<string, ProjectSummary>();
  for (const project of projects) {
    if (isCacheableProject(project)) {
      byId.set(project.id, project);
    }
  }

  return [...byId.values()].slice(0, MAX_CACHED_PROJECTS);
}

export function prepareCachedConversations(conversations: ConversationSummary[]) {
  const byId = new Map<string, ConversationSummary>();
  for (const conversation of conversations) {
    if (isCacheableConversation(conversation)) {
      byId.set(conversation.id, conversation);
    }
  }

  return [...byId.values()]
    .sort((left, right) => {
      const leftTime = left.updatedAt ?? left.createdAt ?? "";
      const rightTime = right.updatedAt ?? right.createdAt ?? "";
      return rightTime.localeCompare(leftTime);
    })
    .slice(0, MAX_CACHED_CONVERSATIONS_PER_PROJECT);
}

async function saveCachedNavigationData(scope: string, data: CachedNavigationData) {
  const path = await navigationCachePath(scope);
  if (!path) {
    return;
  }

  await ensureNavigationCacheDirectory();
  const body: CachedNavigationDataFile = {
    conversationsByProject: prepareCachedConversationsByProject(data.conversationsByProject),
    projects: prepareCachedProjects(data.projects),
    version: NAVIGATION_CACHE_VERSION
  };
  await FileSystem.writeAsStringAsync(path, JSON.stringify(body));
}

function prepareCachedConversationsByProject(
  conversationsByProject: Record<string, ConversationSummary[]>
) {
  return Object.fromEntries(
    Object.entries(conversationsByProject).flatMap(([projectId, conversations]) =>
      typeof projectId === "string" && Array.isArray(conversations)
        ? [[projectId, prepareCachedConversations(conversations)]]
        : []
    )
  );
}

async function navigationCachePath(scope: string) {
  const directory = navigationCacheDirectory();
  if (!directory) {
    return null;
  }

  return `${directory}${safeCachePathPart(scope)}.json`;
}

function navigationCacheDirectory() {
  return FileSystem.documentDirectory
    ? `${FileSystem.documentDirectory}${NAVIGATION_CACHE_DIRECTORY}/`
    : null;
}

async function ensureNavigationCacheDirectory() {
  const directory = navigationCacheDirectory();
  if (!directory) {
    return;
  }

  await FileSystem.makeDirectoryAsync(directory, { intermediates: true });
}

function emptyNavigationData(): CachedNavigationData {
  return {
    conversationsByProject: {},
    projects: []
  };
}

function isConversationMap(value: unknown): value is Record<string, ConversationSummary[]> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isCacheableProject(project: ProjectSummary) {
  return Boolean(project.id && project.workspaceId && project.name);
}

function isCacheableConversation(conversation: ConversationSummary) {
  return Boolean(conversation.id && conversation.projectId && conversation.workspaceId);
}

function safeCachePathPart(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]/gu, "_").slice(0, 160) || "default";
}
