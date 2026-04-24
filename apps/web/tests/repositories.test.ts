import { describe, expect, it } from "vitest";

import {
  createAgentRepository,
  createChangeSetRepository,
  createConversationRepository,
  createMachineRepository,
  createProjectRepository,
  createRunEventRepository,
  createUserRepository,
  createWorkspaceMemberRepository,
  createWorkspaceRepository
} from "../server/repositories";

interface RecordWithId {
  id: string;
}

type CreateArgs<TRecord> = { data: TRecord };
type FindUniqueArgs = { where: { id: string } };
type WorkspaceMemberFindUniqueArgs = {
  where: { workspaceId_userId: { workspaceId: string; userId: string } };
};
type UpdateArgs<TRecord> = { where: { id: string }; data: Partial<TRecord> };
type WorkspaceMemberUpdateArgs<TRecord> = WorkspaceMemberFindUniqueArgs & {
  data: Partial<TRecord>;
};
type FindManyArgs<TRecord> = { where?: Partial<TRecord>; orderBy?: Record<string, "asc" | "desc"> };

class FakeDelegate<TRecord extends RecordWithId> {
  private records = new Map<string, TRecord>();

  async create(args: CreateArgs<TRecord>) {
    this.records.set(args.data.id, args.data);
    return args.data;
  }

  async findUnique(args: FindUniqueArgs) {
    return this.records.get(args.where.id) ?? null;
  }

  async update(args: UpdateArgs<TRecord>) {
    const current = this.records.get(args.where.id);

    if (!current) {
      throw new Error(`Missing record ${args.where.id}`);
    }

    const next = { ...current, ...args.data };
    this.records.set(args.where.id, next);
    return next;
  }

  async findMany(args: FindManyArgs<TRecord> = {}) {
    const entries = Array.from(this.records.values());

    if (!args.where) {
      return entries;
    }

    return entries.filter((entry) =>
      Object.entries(args.where ?? {}).every(
        ([key, value]) => entry[key as keyof TRecord] === value
      )
    );
  }
}

class FakeWorkspaceMemberDelegate<
  TRecord extends { workspaceId: string; userId: string; role: string }
> {
  private records = new Map<string, TRecord>();

  async create(args: CreateArgs<TRecord>) {
    this.records.set(this.key(args.data.workspaceId, args.data.userId), args.data);
    return args.data;
  }

  async findUnique(args: WorkspaceMemberFindUniqueArgs) {
    return (
      this.records.get(
        this.key(args.where.workspaceId_userId.workspaceId, args.where.workspaceId_userId.userId)
      ) ?? null
    );
  }

  async update(args: WorkspaceMemberUpdateArgs<TRecord>) {
    const key = this.key(
      args.where.workspaceId_userId.workspaceId,
      args.where.workspaceId_userId.userId
    );
    const current = this.records.get(key);

    if (!current) {
      throw new Error(`Missing workspace member ${key}`);
    }

    const next = { ...current, ...args.data };
    this.records.set(key, next);
    return next;
  }

  private key(workspaceId: string, userId: string) {
    return `${workspaceId}:${userId}`;
  }
}

function createFakeDb() {
  return {
    user: new FakeDelegate<RecordWithId & { email: string; displayName: string }>(),
    workspace: new FakeDelegate<RecordWithId & { name: string; ownerUserId: string }>(),
    workspaceMember: new FakeWorkspaceMemberDelegate<{
      workspaceId: string;
      userId: string;
      role: string;
    }>(),
    machine: new FakeDelegate<
      RecordWithId & {
        workspaceId: string;
        name: string;
        type: string;
        status: string;
        pairingTokenHash: string;
      }
    >(),
    project: new FakeDelegate<
      RecordWithId & {
        workspaceId: string;
        name: string;
        repoUrl: string;
        defaultBranch: string;
        createdByUserId: string;
      }
    >(),
    agent: new FakeDelegate<
      RecordWithId & {
        projectId: string;
        name: string;
        role: string;
        instructions: string;
        model: string;
        runtime: string;
        createdByUserId: string;
      }
    >(),
    conversation: new FakeDelegate<
      RecordWithId & {
        agentId: string;
        projectId: string;
        workspaceId: string;
        createdByUserId: string;
        type: string;
        status: string;
        prompt: string;
      }
    >(),
    runEvent: new FakeDelegate<
      RecordWithId & {
        conversationId: string;
        sequence: number;
        type: string;
        content: string;
      }
    >(),
    changeSet: new FakeDelegate<
      RecordWithId & {
        conversationId: string;
        filesChangedJson: unknown;
        diffText: string;
      }
    >()
  };
}

describe("backend repositories", () => {
  it("creates, reads, and updates core workspace records", async () => {
    const db = createFakeDb();
    const users = createUserRepository(db);
    const workspaces = createWorkspaceRepository(db);
    const members = createWorkspaceMemberRepository(db);
    const machines = createMachineRepository(db);
    const projects = createProjectRepository(db);
    const agents = createAgentRepository(db);
    const conversations = createConversationRepository(db);
    const runEvents = createRunEventRepository(db);
    const changeSets = createChangeSetRepository(db);

    await users.create({
      id: "user_demo",
      email: "demo@abitat.local",
      displayName: "Demo User"
    });
    await workspaces.create({
      id: "workspace_demo",
      name: "Demo Workspace",
      ownerUserId: "user_demo"
    });
    await members.create({
      workspaceId: "workspace_demo",
      userId: "user_demo",
      role: "owner"
    });
    await machines.create({
      id: "machine_demo",
      workspaceId: "workspace_demo",
      name: "Demo Host",
      type: "host",
      status: "pending",
      pairingTokenHash: "hashed-token"
    });
    await projects.create({
      id: "project_demo",
      workspaceId: "workspace_demo",
      name: "Demo Repo",
      repoUrl: "https://github.com/AbitatDoorothy/Workspace.git",
      defaultBranch: "main",
      createdByUserId: "user_demo"
    });
    await agents.create({
      id: "agent_demo",
      projectId: "project_demo",
      name: "Mock Agent",
      role: "Builder",
      instructions: "Be careful.",
      model: "mock-model",
      runtime: "mock",
      createdByUserId: "user_demo"
    });
    await conversations.create({
      id: "conversation_demo",
      agentId: "agent_demo",
      projectId: "project_demo",
      workspaceId: "workspace_demo",
      createdByUserId: "user_demo",
      type: "feature",
      status: "queued",
      prompt: "Add a demo task."
    });
    await runEvents.create({
      id: "event_demo",
      conversationId: "conversation_demo",
      sequence: 1,
      type: "status",
      content: "queued"
    });
    await changeSets.create({
      id: "changeset_demo",
      conversationId: "conversation_demo",
      filesChangedJson: ["README.md"],
      diffText: "diff --git a/README.md b/README.md"
    });

    await machines.update("machine_demo", { status: "online" });
    await members.updateRole("workspace_demo", "user_demo", "admin");
    await conversations.update("conversation_demo", { status: "running" });
    await runEvents.update("event_demo", { content: "running" });

    expect(await workspaces.findById("workspace_demo")).toMatchObject({
      id: "workspace_demo",
      name: "Demo Workspace"
    });
    expect(await projects.findById("project_demo")).toMatchObject({
      repoUrl: "https://github.com/AbitatDoorothy/Workspace.git"
    });
    expect(await agents.findById("agent_demo")).toMatchObject({ runtime: "mock" });
    expect(await machines.findById("machine_demo")).toMatchObject({ status: "online" });
    expect(await members.findByWorkspaceUser("workspace_demo", "user_demo")).toMatchObject({
      role: "admin"
    });
    expect(await conversations.findById("conversation_demo")).toMatchObject({ status: "running" });
    expect(await runEvents.listForConversation("conversation_demo")).toHaveLength(1);
    expect(await changeSets.findByConversationId("conversation_demo")).toMatchObject({
      id: "changeset_demo"
    });
  });
});
