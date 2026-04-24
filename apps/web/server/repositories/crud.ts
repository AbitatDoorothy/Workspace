import type { EntityDelegate, EntityRepository, IdentifiedRecord } from "./types";

export function createEntityRepository<TRecord extends IdentifiedRecord>(
  delegate: EntityDelegate<TRecord>
): EntityRepository<TRecord> {
  return {
    create(data) {
      return delegate.create({ data });
    },
    findById(id) {
      return delegate.findUnique({ where: { id } });
    },
    update(id, data) {
      return delegate.update({ where: { id }, data });
    }
  };
}
