import type {
  CollectionRefLike,
  DocRefLike,
  DocSnapshotLike,
  FieldValueLike,
  FirestoreLike,
  QueryLike,
  QuerySnapshotLike,
  TransactionLike,
  WriteBatchLike,
} from '../../server/types';

interface Sentinel {
  __sentinel: 'serverTimestamp' | 'increment' | 'delete';
  amount?: number;
}

function isSentinel(value: unknown): value is Sentinel {
  return typeof value === 'object' && value !== null && '__sentinel' in value;
}

function clonePlain<T>(value: T): T {
  if (value === null || value === undefined || typeof value !== 'object') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => clonePlain(item)) as unknown as T;
  }
  if (value instanceof Date) {
    return new Date(value.getTime()) as unknown as T;
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = clonePlain(v);
  }
  return out as T;
}

function resolveValue(current: unknown, incoming: unknown, nowMs: number): unknown {
  if (isSentinel(incoming)) {
    if (incoming.__sentinel === 'serverTimestamp') {
      return new Date(nowMs).toISOString();
    }
    if (incoming.__sentinel === 'increment') {
      return Number(current || 0) + Number(incoming.amount || 0);
    }
    if (incoming.__sentinel === 'delete') {
      return undefined;
    }
  }
  if (
    typeof incoming === 'object' &&
    incoming !== null &&
    !Array.isArray(incoming) &&
    !(incoming instanceof Date)
  ) {
    const base =
      typeof current === 'object' && current !== null && !Array.isArray(current)
        ? { ...(current as Record<string, unknown>) }
        : {};
    for (const [k, v] of Object.entries(incoming as Record<string, unknown>)) {
      const next = resolveValue(base[k], v, nowMs);
      if (next === undefined) {
        delete base[k];
      } else {
        base[k] = next;
      }
    }
    return base;
  }
  return clonePlain(incoming);
}

function applySet(
  store: Map<string, Record<string, unknown>>,
  path: string,
  data: Record<string, unknown>,
  merge: boolean,
  nowMs: number
): void {
  const existing = merge ? store.get(path) || {} : {};
  const next = resolveValue(existing, data, nowMs) as Record<string, unknown>;
  store.set(path, next);
}

function applyUpdate(
  store: Map<string, Record<string, unknown>>,
  path: string,
  data: Record<string, unknown>,
  nowMs: number
): void {
  const existing = store.get(path);
  if (!existing) {
    throw new Error(`Document does not exist at path: ${path}`);
  }
  const next = clonePlain(existing);
  for (const [key, val] of Object.entries(data)) {
    if (key.includes('.')) {
      const parts = key.split('.');
      let cursor: Record<string, unknown> = next;
      for (let i = 0; i < parts.length - 1; i += 1) {
        if (typeof cursor[parts[i]] !== 'object' || cursor[parts[i]] === null) {
          cursor[parts[i]] = {};
        }
        cursor = cursor[parts[i]] as Record<string, unknown>;
      }
      const leaf = parts[parts.length - 1];
      const resolved = resolveValue(cursor[leaf], val, nowMs);
      if (resolved === undefined) {
        delete cursor[leaf];
      } else {
        cursor[leaf] = resolved;
      }
    } else {
      const resolved = resolveValue(next[key], val, nowMs);
      if (resolved === undefined) {
        delete next[key];
      } else {
        next[key] = resolved;
      }
    }
  }
  store.set(path, next);
}

function getField(obj: Record<string, unknown>, field: string): unknown {
  if (!field.includes('.')) return obj[field];
  let cursor: unknown = obj;
  for (const part of field.split('.')) {
    if (typeof cursor !== 'object' || cursor === null) return undefined;
    cursor = (cursor as Record<string, unknown>)[part];
  }
  return cursor;
}

export class InMemoryFirestore implements FirestoreLike {
  private readonly docs = new Map<string, Record<string, unknown>>();
  private readonly nowFn: () => number;

  public readonly fieldValue: FieldValueLike = {
    serverTimestamp: () => ({ __sentinel: 'serverTimestamp' }) satisfies Sentinel,
    increment: (amount: number) => ({ __sentinel: 'increment', amount }) satisfies Sentinel,
    delete: () => ({ __sentinel: 'delete' }) satisfies Sentinel,
  };

  constructor(nowFn: () => number = () => Date.now()) {
    this.nowFn = nowFn;
  }

  public seed(path: string, data: Record<string, unknown>): void {
    this.docs.set(path, clonePlain(data));
  }

  public getRaw(path: string): Record<string, unknown> | undefined {
    const val = this.docs.get(path);
    return val ? clonePlain(val) : undefined;
  }

  public doc(path: string): DocRefLike {
    const cleanPath = path.replace(/^\/+|\/+$/g, '');
    const id = cleanPath.split('/').pop() || '';
    const self = this;

    const ref: DocRefLike = {
      id,
      path: cleanPath,
      async get(): Promise<DocSnapshotLike> {
        const data = self.docs.get(cleanPath);
        return {
          id,
          exists: data !== undefined,
          ref,
          data: () => (data ? clonePlain(data) : undefined),
        };
      },
      async set(data, options): Promise<void> {
        applySet(self.docs, cleanPath, data, Boolean(options?.merge), self.nowFn());
      },
      async update(data): Promise<void> {
        applyUpdate(self.docs, cleanPath, data, self.nowFn());
      },
      async delete(): Promise<void> {
        self.docs.delete(cleanPath);
      },
    };
    return ref;
  }

  private buildQuery(
    matcher: (path: string) => boolean,
    filters: Array<{ field: string; op: '==' | 'in'; value: unknown }> = [],
    maxLimit?: number
  ): QueryLike {
    const self = this;
    return {
      where(field, op, value) {
        return self.buildQuery(matcher, [...filters, { field, op, value }], maxLimit);
      },
      limit(n) {
        return self.buildQuery(matcher, filters, n);
      },
      async get(): Promise<QuerySnapshotLike> {
        const matched: DocSnapshotLike[] = [];
        for (const [docPath, rawData] of self.docs.entries()) {
          if (!matcher(docPath)) continue;
          const ok = filters.every((f) => {
            const actual = getField(rawData, f.field);
            if (f.op === '==') return actual === f.value;
            if (f.op === 'in' && Array.isArray(f.value)) return f.value.includes(actual);
            return false;
          });
          if (!ok) continue;
          const ref = self.doc(docPath);
          matched.push({
            id: ref.id,
            exists: true,
            ref,
            data: () => clonePlain(rawData),
          });
          if (maxLimit !== undefined && matched.length >= maxLimit) break;
        }
        return {
          empty: matched.length === 0,
          size: matched.length,
          docs: matched,
        };
      },
    };
  }

  public collection(path: string): CollectionRefLike {
    const cleanCol = path.replace(/^\/+|\/+$/g, '');
    const depth = cleanCol.split('/').length + 1;
    const query = this.buildQuery((docPath) => {
      const parts = docPath.split('/');
      return parts.length === depth && docPath.startsWith(`${cleanCol}/`);
    });

    return {
      ...query,
      doc: (id?: string) => {
        const docId = id || `auto_${Math.random().toString(36).slice(2, 10)}`;
        return this.doc(`${cleanCol}/${docId}`);
      },
    };
  }

  public collectionGroup(collectionId: string): QueryLike {
    return this.buildQuery((docPath) => {
      const parts = docPath.split('/');
      return parts.length >= 2 && parts[parts.length - 2] === collectionId;
    });
  }

  public async runTransaction<T>(fn: (tx: TransactionLike) => Promise<T>): Promise<T> {
    const shadow = new Map<string, Record<string, unknown>>();
    for (const [k, v] of this.docs.entries()) {
      shadow.set(k, clonePlain(v));
    }
    const self = this;
    const ops: Array<() => void> = [];

    const tx: TransactionLike = {
      async get(ref: DocRefLike): Promise<DocSnapshotLike> {
        const data = shadow.get(ref.path);
        return {
          id: ref.id,
          exists: data !== undefined,
          ref,
          data: () => (data ? clonePlain(data) : undefined),
        };
      },
      set(ref, data, options) {
        ops.push(() => applySet(self.docs, ref.path, data, Boolean(options?.merge), self.nowFn()));
        return tx;
      },
      update(ref, data) {
        ops.push(() => applyUpdate(self.docs, ref.path, data, self.nowFn()));
        return tx;
      },
      delete(ref) {
        ops.push(() => {
          self.docs.delete(ref.path);
        });
        return tx;
      },
    };

    const result = await fn(tx);
    for (const op of ops) {
      op();
    }
    return result;
  }

  public batch(): WriteBatchLike {
    const self = this;
    const ops: Array<() => void> = [];
    const batch: WriteBatchLike = {
      set(ref, data, options) {
        ops.push(() => applySet(self.docs, ref.path, data, Boolean(options?.merge), self.nowFn()));
        return batch;
      },
      update(ref, data) {
        ops.push(() => applyUpdate(self.docs, ref.path, data, self.nowFn()));
        return batch;
      },
      delete(ref) {
        ops.push(() => {
          self.docs.delete(ref.path);
        });
        return batch;
      },
      async commit(): Promise<void> {
        for (const op of ops) {
          op();
        }
      },
    };
    return batch;
  }
}
