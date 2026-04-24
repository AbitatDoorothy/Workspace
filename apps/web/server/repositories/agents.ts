import { createEntityRepository } from "./crud";
import type { EntityDelegate, IdentifiedRecord } from "./types";

export function createAgentRepository<TRecord extends IdentifiedRecord>(db: {
  agent: EntityDelegate<TRecord>;
}) {
  return createEntityRepository(db.agent);
}
