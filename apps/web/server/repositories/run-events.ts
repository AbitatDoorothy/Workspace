import { createEntityRepository } from "./crud";
import type { EntityDelegate, FindManyDelegate, IdentifiedRecord } from "./types";

interface RunEventRecord extends IdentifiedRecord {
  conversationId: string;
}

type RunEventDelegate<TRecord extends RunEventRecord> = EntityDelegate<TRecord> &
  FindManyDelegate<TRecord>;

export function createRunEventRepository<TRecord extends RunEventRecord>(db: {
  runEvent: RunEventDelegate<TRecord>;
}) {
  const base = createEntityRepository(db.runEvent);

  return {
    ...base,
    listForConversation(conversationId: string) {
      return db.runEvent.findMany({
        where: { conversationId } as Partial<TRecord>,
        orderBy: { sequence: "asc" }
      });
    }
  };
}
