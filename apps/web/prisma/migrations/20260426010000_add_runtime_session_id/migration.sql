ALTER TABLE "Conversation" ADD COLUMN "runtimeSessionId" TEXT;

UPDATE "Conversation" AS c
SET "runtimeSessionId" = trim(split_part(e.content, 'session id:', 2))
FROM "RunEvent" AS e
WHERE e."conversationId" = c.id
  AND e.content ILIKE 'session id:%'
  AND c."runtimeSessionId" IS NULL;
