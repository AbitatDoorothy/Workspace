export interface IdentifiedRecord {
  id: string;
}

export interface EntityDelegate<TRecord extends IdentifiedRecord> {
  create(args: { data: TRecord }): Promise<TRecord>;
  findUnique(args: { where: { id: string } }): Promise<TRecord | null>;
  update(args: { where: { id: string }; data: Partial<TRecord> }): Promise<TRecord>;
}

export interface EntityRepository<TRecord extends IdentifiedRecord> {
  create(data: TRecord): Promise<TRecord>;
  findById(id: string): Promise<TRecord | null>;
  update(id: string, data: Partial<TRecord>): Promise<TRecord>;
}

export interface FindManyDelegate<TRecord> {
  findMany(args: {
    where?: Partial<TRecord>;
    orderBy?: Record<string, "asc" | "desc">;
  }): Promise<TRecord[]>;
}
