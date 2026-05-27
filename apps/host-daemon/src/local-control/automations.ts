import { randomBytes } from "node:crypto";
import type { Dirent } from "node:fs";
import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export type CodexAutomationStatus = "ACTIVE" | "PAUSED";

export interface CodexAutomationSummary {
  id: string;
  kind: string;
  name: string;
  prompt: string;
  status: CodexAutomationStatus;
  rrule: string;
  model: string;
  reasoningEffort: string;
  executionEnvironment: string;
  cwds: string[];
  createdAt: number | null;
  updatedAt: number | null;
}

export interface CodexAutomationWriteInput {
  kind: string;
  name: string;
  prompt: string;
  status: CodexAutomationStatus;
  rrule: string;
  model: string;
  reasoningEffort: string;
  executionEnvironment: string;
  cwds: string[];
}

export type CodexAutomationUpdateInput = Partial<CodexAutomationWriteInput>;

interface CodexAutomationStoreOptions {
  now?: () => number;
  rootDir?: string;
}

type TomlValue = string | number | string[];
type TomlRecord = Record<string, TomlValue>;

const AUTOMATION_FILE_NAME = "automation.toml";
const AUTOMATION_ID_PATTERN = /^[A-Za-z0-9._-]+$/u;

export function defaultCodexAutomationsDirectory() {
  return join(homedir(), ".codex", "automations");
}

export async function listCodexAutomations(
  options: CodexAutomationStoreOptions = {}
): Promise<CodexAutomationSummary[]> {
  const rootDir = automationRoot(options);
  let entries: Dirent[];
  try {
    entries = await readdir(rootDir, { withFileTypes: true });
  } catch (error) {
    if (isNotFoundError(error)) {
      return [];
    }
    throw error;
  }

  const automations = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory())
      .map(async (entry) => readAutomation(rootDir, entry.name).catch(() => null))
  );

  return automations
    .filter((automation): automation is CodexAutomationSummary => automation !== null)
    .sort(
      (left, right) =>
        (right.updatedAt ?? right.createdAt ?? 0) - (left.updatedAt ?? left.createdAt ?? 0) ||
        left.name.localeCompare(right.name)
    );
}

export async function createCodexAutomation(
  options: CodexAutomationStoreOptions,
  input: CodexAutomationWriteInput
) {
  const rootDir = automationRoot(options);
  const id = await uniqueAutomationId(rootDir, slugifyAutomationName(input.name));
  const timestamp = now(options);
  const record = {
    ...recordFromInput(input),
    created_at: timestamp,
    id,
    updated_at: timestamp,
    version: 1
  };
  await writeAutomationRecord(rootDir, id, record);
  return automationFromRecord(record);
}

export async function updateCodexAutomation(
  options: CodexAutomationStoreOptions,
  id: string,
  input: CodexAutomationUpdateInput
) {
  validateAutomationId(id);
  const rootDir = automationRoot(options);
  const currentRecord = await readAutomationRecord(rootDir, id);
  const current = automationFromRecord({
    ...currentRecord,
    id: stringRecordValue(currentRecord.id) || id
  });
  const next: CodexAutomationSummary = {
    ...current,
    ...input,
    id,
    updatedAt: now(options)
  };
  const nextRecord = {
    ...currentRecord,
    ...recordFromAutomation(next),
    id
  };
  await writeAutomationRecord(rootDir, id, nextRecord);
  return automationFromRecord(nextRecord);
}

async function readAutomation(rootDir: string, id: string) {
  const record = await readAutomationRecord(rootDir, id);
  return automationFromRecord({
    ...record,
    id: stringRecordValue(record.id) || id
  });
}

async function readAutomationRecord(rootDir: string, id: string) {
  validateAutomationId(id);
  return parseTomlRecord(await readFile(join(rootDir, id, AUTOMATION_FILE_NAME), "utf8"));
}

async function writeAutomationRecord(rootDir: string, id: string, record: TomlRecord) {
  validateAutomationId(id);
  const filePath = join(rootDir, id, AUTOMATION_FILE_NAME);
  await mkdir(dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.${randomBytes(6).toString("hex")}.tmp`;
  await writeFile(tempPath, serializeTomlRecord(record), "utf8");
  await rename(tempPath, filePath);
}

function automationFromRecord(record: TomlRecord): CodexAutomationSummary {
  const id = requiredString(record.id, "Automation id is required");
  validateAutomationId(id);
  return {
    createdAt: numberRecordValue(record.created_at),
    cwds: stringArrayRecordValue(record.cwds),
    executionEnvironment: stringRecordValue(record.execution_environment) || "local",
    id,
    kind: stringRecordValue(record.kind) || "cron",
    model: stringRecordValue(record.model) || "",
    name: requiredString(record.name, "Automation name is required"),
    prompt: requiredString(record.prompt, "Automation prompt is required"),
    reasoningEffort: stringRecordValue(record.reasoning_effort) || "medium",
    rrule: stringRecordValue(record.rrule) || "",
    status: statusRecordValue(record.status),
    updatedAt: numberRecordValue(record.updated_at)
  };
}

function recordFromInput(input: CodexAutomationWriteInput): TomlRecord {
  return {
    cwds: input.cwds,
    execution_environment: input.executionEnvironment,
    kind: input.kind,
    model: input.model,
    name: input.name,
    prompt: input.prompt,
    reasoning_effort: input.reasoningEffort,
    rrule: input.rrule,
    status: input.status
  };
}

function recordFromAutomation(automation: CodexAutomationSummary): TomlRecord {
  return {
    created_at: Math.trunc(automation.createdAt ?? Date.now()),
    cwds: automation.cwds,
    execution_environment: automation.executionEnvironment,
    id: automation.id,
    kind: automation.kind,
    model: automation.model,
    name: automation.name,
    prompt: automation.prompt,
    reasoning_effort: automation.reasoningEffort,
    rrule: automation.rrule,
    status: automation.status,
    updated_at: Math.trunc(automation.updatedAt ?? Date.now()),
    version: 1
  };
}

function serializeTomlRecord(record: TomlRecord) {
  const orderedKeys = [
    "version",
    "id",
    "kind",
    "name",
    "prompt",
    "status",
    "rrule",
    "model",
    "reasoning_effort",
    "execution_environment",
    "cwds",
    "created_at",
    "updated_at"
  ];
  const keys = [
    ...orderedKeys.filter((key) => key in record),
    ...Object.keys(record).filter((key) => !orderedKeys.includes(key))
  ];
  const lines = keys.map((key) => `${key} = ${tomlValue(record[key])}`);
  return `${lines.join("\n")}\n`;
}

function tomlValue(value: TomlValue | undefined) {
  if (Array.isArray(value)) {
    return tomlStringArray(value);
  }
  if (typeof value === "number") {
    return String(Math.trunc(value));
  }
  return tomlString(value ?? "");
}

function parseTomlRecord(toml: string): TomlRecord {
  const record: TomlRecord = {};
  for (const rawLine of toml.split(/\r?\n/u)) {
    const line = stripTomlComment(rawLine).trim();
    if (!line || line.startsWith("[")) {
      continue;
    }

    const separatorIndex = line.indexOf("=");
    if (separatorIndex <= 0) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    const rawValue = line.slice(separatorIndex + 1).trim();
    record[key] = parseTomlValue(rawValue);
  }
  return record;
}

function parseTomlValue(rawValue: string): TomlValue {
  if (rawValue.startsWith('"')) {
    return parseTomlString(rawValue);
  }
  if (rawValue.startsWith("[")) {
    return parseTomlStringArray(rawValue);
  }
  if (/^-?\d+$/u.test(rawValue)) {
    return Number(rawValue);
  }
  return rawValue;
}

function parseTomlString(rawValue: string) {
  const match = rawValue.match(/^"((?:\\.|[^"\\])*)"/u);
  if (!match) {
    return "";
  }
  return match[1]
    .replace(/\\n/gu, "\n")
    .replace(/\\r/gu, "\r")
    .replace(/\\"/gu, '"')
    .replace(/\\\\/gu, "\\");
}

function parseTomlStringArray(rawValue: string) {
  const values: string[] = [];
  const body = rawValue.replace(/^\[/u, "").replace(/\]\s*$/u, "");
  const pattern = /"((?:\\.|[^"\\])*)"/gu;
  for (const match of body.matchAll(pattern)) {
    values.push(parseTomlString(`"${match[1]}"`));
  }
  return values;
}

function stripTomlComment(line: string) {
  let inString = false;
  let escaped = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (character === "\\") {
      escaped = true;
      continue;
    }
    if (character === '"') {
      inString = !inString;
      continue;
    }
    if (character === "#" && !inString) {
      return line.slice(0, index);
    }
  }
  return line;
}

async function uniqueAutomationId(rootDir: string, baseId: string) {
  const candidate = baseId || "automation";
  for (let index = 0; index < 100; index += 1) {
    const id = index === 0 ? candidate : `${candidate}-${index + 1}`;
    try {
      await readFile(join(rootDir, id, AUTOMATION_FILE_NAME), "utf8");
    } catch (error) {
      if (isNotFoundError(error)) {
        return id;
      }
      throw error;
    }
  }

  return `${candidate}-${randomBytes(4).toString("hex")}`;
}

function slugifyAutomationName(name: string) {
  return (
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9._-]+/gu, "-")
      .replace(/^-+|-+$/gu, "")
      .slice(0, 80) || "automation"
  );
}

function tomlString(value: string) {
  return `"${value
    .replace(/\\/gu, "\\\\")
    .replace(/"/gu, '\\"')
    .replace(/\r/gu, "\\r")
    .replace(/\n/gu, "\\n")}"`;
}

function tomlStringArray(values: string[]) {
  return `[${values.map((value) => tomlString(value)).join(", ")}]`;
}

function requiredString(value: TomlValue | undefined, message: string) {
  const stringValue = stringRecordValue(value);
  if (!stringValue) {
    throw new Error(message);
  }
  return stringValue;
}

function stringRecordValue(value: TomlValue | undefined) {
  return typeof value === "string" ? value : "";
}

function numberRecordValue(value: TomlValue | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function stringArrayRecordValue(value: TomlValue | undefined) {
  return Array.isArray(value) ? value.filter((entry) => typeof entry === "string") : [];
}

function statusRecordValue(value: TomlValue | undefined): CodexAutomationStatus {
  return stringRecordValue(value) === "PAUSED" ? "PAUSED" : "ACTIVE";
}

function automationRoot(options: CodexAutomationStoreOptions) {
  return options.rootDir ?? defaultCodexAutomationsDirectory();
}

function now(options: CodexAutomationStoreOptions) {
  return Math.trunc(options.now?.() ?? Date.now());
}

function validateAutomationId(id: string) {
  if (!AUTOMATION_ID_PATTERN.test(id)) {
    throw Object.assign(new Error("Invalid automation id"), { statusCode: 400 });
  }
}

function isNotFoundError(error: unknown) {
  return Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT");
}
