import { createEntityRepository } from "./crud";
import type { EntityDelegate, IdentifiedRecord } from "./types";

export function createMachineRepository<TRecord extends IdentifiedRecord>(db: {
  machine: EntityDelegate<TRecord>;
}) {
  return createEntityRepository(db.machine);
}
