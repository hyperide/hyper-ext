/** Experimental authoring facade, not the production state/query API.
 * A plan is inspectable and immutable; execution deliberately recomputes.
 * Callback nodes / joins / backend translation require a separate contract.
 */
export type Row = Record<string, unknown>;
export type Order<T> = { field: keyof T & string; direction: 'asc' | 'desc' };
export type Plan<T> = { where: Partial<T>[]; order: Order<T>[]; take?: number; select?: (keyof T & string)[] };
export class View<T extends Row> {
  constructor(private readonly rows: readonly T[], private readonly plan: Plan<T> = { where: [], order: [] }) {}
  where(eq: Partial<T>): View<T> { return new View(this.rows, { ...this.plan, where: [...this.plan.where, {...eq}] }); }
  orderBy(field: keyof T & string, direction: 'asc' | 'desc' = 'asc'): View<T> { return new View(this.rows, { ...this.plan, order: [...this.plan.order, {field, direction}] }); }
  take(n: number): View<T> { if (!Number.isSafeInteger(n) || n < 0) throw new Error('take must be a non-negative safe integer'); return new View(this.rows, { ...this.plan, take: n }); }
  select<K extends keyof T & string>(...fields: K[]): Pick<T,K>[] {
    return new View(this.rows, { ...this.plan, select: fields }).run() as Pick<T,K>[];
  }
  map<R>(fn: (row: T, index: number) => R): R[] { return this.run().map(fn); }
  sum<K extends keyof T & string>(field: K): number {
    return this.run().reduce((total, row) => {
      const value = row[field];
      if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error('sum fields must contain finite numbers');
      return total + value;
    }, 0);
  }
  run(): T[] {
    const out = this.rows.filter(row => this.plan.where.every(p => Object.entries(p).every(([key, value]) => Object.is(row[key], value))));
    if (this.plan.order.length) out.sort((a, b) => {
      for (const { field, direction } of this.plan.order) {
        const x = a[field], y = b[field];
        if (Object.is(x, y)) continue;
        if (x == null || y == null) throw new Error('Specify null ordering before using nullable sort keys');
        if (typeof x !== typeof y || !['number','string','boolean'].includes(typeof x) || (typeof x === 'number' && (!Number.isFinite(x) || !Number.isFinite(y as number)))) throw new Error('Sort keys must be homogeneous finite numbers, strings or booleans');
        const d = x < y ? -1 : x > y ? 1 : 0;
        if (d) return direction === 'asc' ? d : -d;
      }
      return 0;
    });
    const limited = this.plan.take == null ? out : out.slice(0, this.plan.take);
    return this.plan.select ? limited.map(row => Object.fromEntries(this.plan.select!.map(k => [k, row[k]])) as T) : limited;
  }
  explain(): { kind: 'experimental-view-plan'; execution: 'full-recompute' } & Plan<T> {
    return structuredClone({kind:'experimental-view-plan' as const, execution:'full-recompute' as const, ...this.plan});
  }
}
export const view = { from: <T extends Row>(rows: readonly T[]) => new View(rows) };
