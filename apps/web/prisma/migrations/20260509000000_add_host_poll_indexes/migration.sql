CREATE INDEX "Workspace_ownerUserId_createdAt_idx" ON "Workspace"("ownerUserId", "createdAt");
CREATE INDEX "Machine_ownerUserId_workspaceId_type_createdAt_idx" ON "Machine"("ownerUserId", "workspaceId", "type", "createdAt");
CREATE INDEX "DaemonJob_machineId_status_updatedAt_idx" ON "DaemonJob"("machineId", "status", "updatedAt");
CREATE INDEX "DaemonJob_status_type_createdAt_idx" ON "DaemonJob"("status", "type", "createdAt");
