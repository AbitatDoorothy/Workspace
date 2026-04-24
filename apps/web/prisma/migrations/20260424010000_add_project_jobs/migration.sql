ALTER TABLE "Project" ADD COLUMN "repoSyncStatus" TEXT NOT NULL DEFAULT 'pending';

CREATE TABLE "DaemonJob" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "machineId" TEXT,
  "projectId" TEXT,
  "conversationId" TEXT,
  "type" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'queued',
  "payloadJson" JSONB NOT NULL,
  "errorMessage" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DaemonJob_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "DaemonJob_workspaceId_idx" ON "DaemonJob"("workspaceId");
CREATE INDEX "DaemonJob_machineId_idx" ON "DaemonJob"("machineId");
CREATE INDEX "DaemonJob_projectId_idx" ON "DaemonJob"("projectId");
CREATE INDEX "DaemonJob_conversationId_idx" ON "DaemonJob"("conversationId");
CREATE INDEX "DaemonJob_status_idx" ON "DaemonJob"("status");

ALTER TABLE "DaemonJob" ADD CONSTRAINT "DaemonJob_machineId_fkey"
  FOREIGN KEY ("machineId") REFERENCES "Machine"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "DaemonJob" ADD CONSTRAINT "DaemonJob_projectId_fkey"
  FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DaemonJob" ADD CONSTRAINT "DaemonJob_conversationId_fkey"
  FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
