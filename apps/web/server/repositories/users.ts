import { createEntityRepository } from "./crud";
import type { EntityDelegate, IdentifiedRecord } from "./types";

export function createUserRepository<TRecord extends IdentifiedRecord>(db: {
  user: EntityDelegate<TRecord>;
}) {
  return createEntityRepository(db.user);
}
