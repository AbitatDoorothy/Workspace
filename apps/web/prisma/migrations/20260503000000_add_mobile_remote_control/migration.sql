CREATE TYPE "ConversationMessageRole" AS ENUM ('user', 'assistant', 'system', 'runtime');
CREATE TYPE "RemoteControlStatus" AS ENUM ('requested', 'connecting', 'active', 'ended', 'failed');

ALTER TABLE "Machine"
  ADD COLUMN "ownerUserId" TEXT,
  ADD COLUMN "platform" TEXT,
  ADD COLUMN "deviceKind" TEXT,
  ADD COLUMN "publicKey" TEXT,
  ADD COLUMN "tokenHash" TEXT,
  ADD COLUMN "pairedHostMachineId" TEXT,
  ADD COLUMN "capabilitiesJson" JSONB;

CREATE TABLE "DevicePairing" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "hostMachineId" TEXT NOT NULL,
  "createdByUserId" TEXT NOT NULL,
  "codeHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "consumedAt" TIMESTAMP(3),
  "approvedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DevicePairing_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ConversationMessage" (
  "id" TEXT NOT NULL,
  "conversationId" TEXT NOT NULL,
  "sequence" INTEGER NOT NULL,
  "role" "ConversationMessageRole" NOT NULL,
  "sourceDeviceId" TEXT,
  "clientMessageId" TEXT,
  "content" TEXT NOT NULL,
  "metadataJson" JSONB NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ConversationMessage_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "RemoteControlSession" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "hostMachineId" TEXT NOT NULL,
  "clientMachineId" TEXT NOT NULL,
  "createdByUserId" TEXT NOT NULL,
  "status" "RemoteControlStatus" NOT NULL DEFAULT 'requested',
  "screenEnabled" BOOLEAN NOT NULL DEFAULT true,
  "inputEnabled" BOOLEAN NOT NULL DEFAULT true,
  "startedAt" TIMESTAMP(3),
  "endedAt" TIMESTAMP(3),
  "errorMessage" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "RemoteControlSession_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "RemoteControlSignal" (
  "id" TEXT NOT NULL,
  "sessionId" TEXT NOT NULL,
  "senderMachineId" TEXT NOT NULL,
  "recipientMachineId" TEXT,
  "type" TEXT NOT NULL,
  "payloadJson" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RemoteControlSignal_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Machine_tokenHash_key" ON "Machine"("tokenHash");
CREATE INDEX "Machine_ownerUserId_idx" ON "Machine"("ownerUserId");
CREATE INDEX "Machine_pairedHostMachineId_idx" ON "Machine"("pairedHostMachineId");

CREATE UNIQUE INDEX "DevicePairing_codeHash_key" ON "DevicePairing"("codeHash");
CREATE INDEX "DevicePairing_workspaceId_idx" ON "DevicePairing"("workspaceId");
CREATE INDEX "DevicePairing_hostMachineId_idx" ON "DevicePairing"("hostMachineId");
CREATE INDEX "DevicePairing_createdByUserId_idx" ON "DevicePairing"("createdByUserId");
CREATE INDEX "DevicePairing_expiresAt_idx" ON "DevicePairing"("expiresAt");

CREATE UNIQUE INDEX "ConversationMessage_conversationId_sequence_key"
  ON "ConversationMessage"("conversationId", "sequence");
CREATE UNIQUE INDEX "ConversationMessage_conversationId_clientMessageId_key"
  ON "ConversationMessage"("conversationId", "clientMessageId");
CREATE INDEX "ConversationMessage_conversationId_idx" ON "ConversationMessage"("conversationId");
CREATE INDEX "ConversationMessage_sourceDeviceId_idx" ON "ConversationMessage"("sourceDeviceId");

CREATE INDEX "RemoteControlSession_workspaceId_idx" ON "RemoteControlSession"("workspaceId");
CREATE INDEX "RemoteControlSession_hostMachineId_idx" ON "RemoteControlSession"("hostMachineId");
CREATE INDEX "RemoteControlSession_clientMachineId_idx" ON "RemoteControlSession"("clientMachineId");
CREATE INDEX "RemoteControlSession_createdByUserId_idx" ON "RemoteControlSession"("createdByUserId");
CREATE INDEX "RemoteControlSession_status_idx" ON "RemoteControlSession"("status");

CREATE INDEX "RemoteControlSignal_sessionId_idx" ON "RemoteControlSignal"("sessionId");
CREATE INDEX "RemoteControlSignal_senderMachineId_idx" ON "RemoteControlSignal"("senderMachineId");
CREATE INDEX "RemoteControlSignal_recipientMachineId_idx" ON "RemoteControlSignal"("recipientMachineId");
CREATE INDEX "RemoteControlSignal_createdAt_idx" ON "RemoteControlSignal"("createdAt");

ALTER TABLE "Machine" ADD CONSTRAINT "Machine_ownerUserId_fkey"
  FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Machine" ADD CONSTRAINT "Machine_pairedHostMachineId_fkey"
  FOREIGN KEY ("pairedHostMachineId") REFERENCES "Machine"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "DevicePairing" ADD CONSTRAINT "DevicePairing_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DevicePairing" ADD CONSTRAINT "DevicePairing_hostMachineId_fkey"
  FOREIGN KEY ("hostMachineId") REFERENCES "Machine"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "DevicePairing" ADD CONSTRAINT "DevicePairing_createdByUserId_fkey"
  FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ConversationMessage" ADD CONSTRAINT "ConversationMessage_conversationId_fkey"
  FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ConversationMessage" ADD CONSTRAINT "ConversationMessage_sourceDeviceId_fkey"
  FOREIGN KEY ("sourceDeviceId") REFERENCES "Machine"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "RemoteControlSession" ADD CONSTRAINT "RemoteControlSession_workspaceId_fkey"
  FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RemoteControlSession" ADD CONSTRAINT "RemoteControlSession_hostMachineId_fkey"
  FOREIGN KEY ("hostMachineId") REFERENCES "Machine"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RemoteControlSession" ADD CONSTRAINT "RemoteControlSession_clientMachineId_fkey"
  FOREIGN KEY ("clientMachineId") REFERENCES "Machine"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RemoteControlSession" ADD CONSTRAINT "RemoteControlSession_createdByUserId_fkey"
  FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "RemoteControlSignal" ADD CONSTRAINT "RemoteControlSignal_sessionId_fkey"
  FOREIGN KEY ("sessionId") REFERENCES "RemoteControlSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RemoteControlSignal" ADD CONSTRAINT "RemoteControlSignal_senderMachineId_fkey"
  FOREIGN KEY ("senderMachineId") REFERENCES "Machine"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RemoteControlSignal" ADD CONSTRAINT "RemoteControlSignal_recipientMachineId_fkey"
  FOREIGN KEY ("recipientMachineId") REFERENCES "Machine"("id") ON DELETE CASCADE ON UPDATE CASCADE;
