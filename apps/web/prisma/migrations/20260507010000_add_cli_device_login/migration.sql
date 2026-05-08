CREATE TABLE "CliDeviceLogin" (
  "id" TEXT NOT NULL,
  "codeHash" TEXT NOT NULL,
  "userId" TEXT,
  "cliTokenHash" TEXT,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "consumedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CliDeviceLogin_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CliDeviceLogin_codeHash_key" ON "CliDeviceLogin"("codeHash");
CREATE INDEX "CliDeviceLogin_expiresAt_idx" ON "CliDeviceLogin"("expiresAt");
CREATE INDEX "CliDeviceLogin_userId_idx" ON "CliDeviceLogin"("userId");
