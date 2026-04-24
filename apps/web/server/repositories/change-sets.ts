import { createEntityRepository } from "./crud";
import type { EntityDelegate, FindManyDelegate, IdentifiedRecord } from "./types";

interface ChangeSetRecord extends IdentifiedRecord {
  conversationId: string;
}

type ChangeSetDelegate<TRecord extends ChangeSetRecord> = EntityDelegate<TRecord> &
  FindManyDelegate<TRecord>;

export function createChangeSetRepository<TRecord extends ChangeSetRecord>(db: {
  changeSet: ChangeSetDelegate<TRecord>;
}) {
  const base = createEntityRepository(db.changeSet);

  return {
    ...base,
    async findByConversationId(conversationId: string) {
      const [changeSet = null] = await db.changeSet.findMany({
        where: { conversationId } as Partial<TRecord>
      });

      return changeSet;
    }
  };
}
