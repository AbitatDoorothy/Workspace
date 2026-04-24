import { createEntityRepository } from "./crud";
import type { EntityDelegate, IdentifiedRecord } from "./types";

export function createConversationRepository<TRecord extends IdentifiedRecord>(db: {
  conversation: EntityDelegate<TRecord>;
}) {
  return createEntityRepository(db.conversation);
}
