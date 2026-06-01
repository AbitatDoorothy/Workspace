import { readdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

export type PluginSuggestionKind = "plugin" | "skill";
export type PluginSuggestionSource = "plugin" | "plugin-skill" | "codex-skill" | "agents-skill";

export interface PluginSuggestion {
  description: string;
  displayName: string;
  id: string;
  invocationName: string;
  keywords: string[];
  kind: PluginSuggestionKind;
  path?: string;
  pluginName?: string;
  skillName?: string;
  source: PluginSuggestionSource;
}

export interface PluginSkillSelection {
  id: string;
}

export interface CodexSkillInput {
  name: string;
  path: string;
  type: "skill";
}

interface PluginSuggestionOptions {
  agentsHome?: string;
  codexHome?: string;
}

interface PluginManifest {
  description?: string;
  interface?: {
    displayName?: string;
    longDescription?: string;
    shortDescription?: string;
  };
  keywords?: unknown;
  name?: string;
  skills?: unknown;
}

interface SkillFrontmatter {
  description?: string;
  name?: string;
}

const MAX_RECURSIVE_SCAN_DEPTH = 10;

export async function listPluginSuggestions(
  options: PluginSuggestionOptions = {}
): Promise<PluginSuggestion[]> {
  const codexHome = options.codexHome ?? process.env.CODEX_HOME ?? join(homedir(), ".codex");
  const agentsHome = options.agentsHome ?? process.env.AGENTS_HOME ?? join(homedir(), ".agents");
  const pluginSuggestions = await pluginCatalogSuggestions(codexHome);
  const localSuggestions = [
    ...(await localSkillSuggestions(join(codexHome, "skills"), "codex")),
    ...(await localSkillSuggestions(join(agentsHome, "skills"), "agents"))
  ];

  return [...pluginSuggestions, ...localSuggestions].sort(compareSuggestions);
}

export function publicPluginSuggestions(suggestions: PluginSuggestion[]) {
  return suggestions.map(({ path: _path, ...suggestion }) => suggestion);
}

export async function resolvePluginSkillSelections(
  selections: PluginSkillSelection[] | undefined,
  options: PluginSuggestionOptions = {}
): Promise<CodexSkillInput[]> {
  if (!selections?.length) {
    return [];
  }

  const suggestions = await listPluginSuggestions(options);
  const suggestionsById = new Map(suggestions.map((suggestion) => [suggestion.id, suggestion]));

  return selections.flatMap((selection): CodexSkillInput[] => {
    const suggestion = suggestionsById.get(selection.id);
    if (!suggestion?.path) {
      return [];
    }

    const name = suggestion.skillName ?? suggestion.pluginName ?? suggestion.invocationName;
    return [{ name, path: suggestion.path, type: "skill" }];
  });
}

async function pluginCatalogSuggestions(codexHome: string): Promise<PluginSuggestion[]> {
  const manifestPaths = await findFiles(
    join(codexHome, "plugins", "cache"),
    (path) => path.endsWith("/.codex-plugin/plugin.json")
  );
  const suggestions: PluginSuggestion[] = [];

  for (const manifestPath of manifestPaths) {
    const pluginRoot = dirname(dirname(manifestPath));
    const manifest = await readPluginManifest(manifestPath);
    if (!manifest) {
      continue;
    }

    const pluginName = safeName(manifest.name);
    if (!pluginName) {
      continue;
    }

    const pluginKeywords = stringArray(manifest.keywords);
    const skillsDirectory =
      typeof manifest.skills === "string" && manifest.skills.trim()
        ? resolve(pluginRoot, manifest.skills)
        : join(pluginRoot, "skills");
    const skillSuggestions = await pluginSkillSuggestions({
      pluginKeywords,
      pluginName,
      pluginRoot,
      skillsDirectory
    });
    const defaultSkillPath =
      skillSuggestions.find((skill) => skill.skillName === pluginName)?.path ??
      (skillSuggestions.length === 1 ? skillSuggestions[0]?.path : undefined);

    suggestions.push({
      description:
        cleanString(manifest.interface?.shortDescription) ||
        cleanString(manifest.description) ||
        cleanString(manifest.interface?.longDescription),
      displayName: cleanString(manifest.interface?.displayName) || titleize(pluginName),
      id: `plugin:${pluginName}`,
      invocationName: pluginName,
      keywords: uniqueKeywords([pluginName, ...pluginKeywords]),
      kind: "plugin",
      path: defaultSkillPath,
      pluginName,
      source: "plugin"
    });
    suggestions.push(...skillSuggestions);
  }

  return suggestions;
}

async function pluginSkillSuggestions(input: {
  pluginKeywords: string[];
  pluginName: string;
  pluginRoot: string;
  skillsDirectory: string;
}) {
  const skillPaths = await findFiles(input.skillsDirectory, (path) => path.endsWith("/SKILL.md"), 4);
  const suggestions: PluginSuggestion[] = [];

  for (const skillPath of skillPaths) {
    const frontmatter = await readSkillFrontmatter(skillPath);
    const skillName = safeName(frontmatter?.name) || safeName(dirname(skillPath).split("/").at(-1));
    if (!skillName) {
      continue;
    }

    suggestions.push({
      description: cleanString(frontmatter?.description),
      displayName: titleize(skillName),
      id: `skill:${input.pluginName}:${skillName}`,
      invocationName: `${input.pluginName}:${skillName}`,
      keywords: uniqueKeywords([skillName, input.pluginName, ...input.pluginKeywords]),
      kind: "skill",
      path: skillPath,
      pluginName: input.pluginName,
      skillName,
      source: "plugin-skill"
    });
  }

  return suggestions;
}

async function localSkillSuggestions(root: string, scope: "agents" | "codex") {
  const entries = await readDirectory(root);
  const suggestions: PluginSuggestion[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const skillPath = join(root, entry.name, "SKILL.md");
    const frontmatter = await readSkillFrontmatter(skillPath);
    if (!frontmatter) {
      continue;
    }

    const skillName = safeName(frontmatter.name) || safeName(entry.name);
    if (!skillName) {
      continue;
    }

    suggestions.push({
      description: cleanString(frontmatter.description),
      displayName: titleize(skillName),
      id: `skill:${scope}:${skillName}`,
      invocationName: skillName,
      keywords: uniqueKeywords([skillName, scope]),
      kind: "skill",
      path: skillPath,
      skillName,
      source: scope === "codex" ? "codex-skill" : "agents-skill"
    });
  }

  return suggestions;
}

async function readPluginManifest(path: string) {
  try {
    return JSON.parse(await readFile(path, "utf8")) as PluginManifest;
  } catch {
    return null;
  }
}

async function readSkillFrontmatter(path: string): Promise<SkillFrontmatter | null> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch {
    return null;
  }

  if (!text.startsWith("---")) {
    return {};
  }

  const match = /^---\r?\n([\s\S]*?)\r?\n---/u.exec(text);
  if (!match) {
    return {};
  }

  const frontmatter: SkillFrontmatter = {};
  for (const line of match[1].split(/\r?\n/u)) {
    const separatorIndex = line.indexOf(":");
    if (separatorIndex <= 0) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    const value = unquoteYamlScalar(line.slice(separatorIndex + 1).trim());
    if (key === "name") {
      frontmatter.name = value;
    } else if (key === "description") {
      frontmatter.description = value;
    }
  }

  return frontmatter;
}

async function findFiles(
  root: string,
  matches: (path: string) => boolean,
  maxDepth = MAX_RECURSIVE_SCAN_DEPTH
) {
  const found: string[] = [];

  async function scan(directory: string, depth: number) {
    if (depth < 0) {
      return;
    }

    const entries = await readDirectory(directory);
    for (const entry of entries) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        await scan(path, depth - 1);
      } else if (entry.isFile() && matches(path)) {
        found.push(path);
      }
    }
  }

  await scan(root, maxDepth);
  return found;
}

async function readDirectory(path: string) {
  try {
    return await readdir(path, { withFileTypes: true });
  } catch {
    return [];
  }
}

function compareSuggestions(left: PluginSuggestion, right: PluginSuggestion) {
  const rank = sourceRank(left.source) - sourceRank(right.source);
  if (rank !== 0) {
    return rank;
  }

  return left.displayName.localeCompare(right.displayName) || left.id.localeCompare(right.id);
}

function sourceRank(source: PluginSuggestionSource) {
  switch (source) {
    case "plugin":
      return 0;
    case "plugin-skill":
      return 1;
    case "codex-skill":
      return 2;
    case "agents-skill":
      return 3;
  }
}

function cleanString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function safeName(value: unknown) {
  const cleaned = cleanString(value);
  return /^[A-Za-z0-9_.-]+$/u.test(cleaned) ? cleaned : "";
}

function stringArray(value: unknown) {
  return Array.isArray(value) ? value.flatMap((item) => (typeof item === "string" ? [item] : [])) : [];
}

function titleize(value: string) {
  return value
    .split(/[-_.\s]+/u)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function unquoteYamlScalar(value: string) {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function uniqueKeywords(values: string[]) {
  const keywords = new Set<string>();
  for (const value of values) {
    for (const part of value.split(/[^A-Za-z0-9_.-]+/u)) {
      const keyword = part.trim().toLowerCase();
      if (keyword) {
        keywords.add(keyword);
      }
    }
  }
  return Array.from(keywords);
}
