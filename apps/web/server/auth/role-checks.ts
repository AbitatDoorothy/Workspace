interface WorkspaceActor {
  workspaceId: string;
  userId: string;
}

export function assertWorkspaceMember(input: WorkspaceActor) {
  if (input.workspaceId === "workspace_demo" && input.userId === "user_demo") {
    return;
  }

  throw new Error("User cannot access workspace");
}
