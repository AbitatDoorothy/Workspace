import { createEntityRepository } from "./crud";
import type { EntityDelegate, IdentifiedRecord } from "./types";

export function createWorkspaceRepository<TRecord extends IdentifiedRecord>(db: {
  workspace: EntityDelegate<TRecord>;
}) {
  return createEntityRepository(db.workspace);
}
