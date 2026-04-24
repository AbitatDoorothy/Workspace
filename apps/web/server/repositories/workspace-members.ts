interface WorkspaceMemberRecord {
  workspaceId: string;
  userId: string;
  role: string;
}

interface WorkspaceMemberDelegate<TRecord extends WorkspaceMemberRecord> {
  create(args: { data: TRecord }): Promise<TRecord>;
  findUnique(args: {
    where: { workspaceId_userId: { workspaceId: string; userId: string } };
  }): Promise<TRecord | null>;
  update(args: {
    where: { workspaceId_userId: { workspaceId: string; userId: string } };
    data: Partial<TRecord>;
  }): Promise<TRecord>;
}

export function createWorkspaceMemberRepository<TRecord extends WorkspaceMemberRecord>(db: {
  workspaceMember: WorkspaceMemberDelegate<TRecord>;
}) {
  return {
    create(data: TRecord) {
      return db.workspaceMember.create({ data });
    },
    findByWorkspaceUser(workspaceId: string, userId: string) {
      return db.workspaceMember.findUnique({
        where: {
          workspaceId_userId: {
            workspaceId,
            userId
          }
        }
      });
    },
    updateRole(workspaceId: string, userId: string, role: TRecord["role"]) {
      return db.workspaceMember.update({
        where: {
          workspaceId_userId: {
            workspaceId,
            userId
          }
        },
        data: { role } as Partial<TRecord>
      });
    }
  };
}
