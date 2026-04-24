import { createEntityRepository } from "./crud";
import type { EntityDelegate, IdentifiedRecord } from "./types";

export function createProjectRepository<TRecord extends IdentifiedRecord>(db: {
  project: EntityDelegate<TRecord>;
}) {
  return createEntityRepository(db.project);
}
