import type { ResourceClient } from './resourceClient.js';

export interface ResourceStoreSnapshot<T extends { id: string }> {
  items: T[];
  error: unknown;
  pendingCount: number;
  resolvedOnce: boolean;
}

export interface ResourceStore<T extends { id: string }> {
  subscribe(listener: () => void): () => void;
  getSnapshot(): ResourceStoreSnapshot<T>;
  getById(id: string): T | undefined;
  load(force?: boolean): Promise<T[]>;
  createItem(input: Partial<T>): Promise<T>;
  updateItem(id: string, input: Partial<T>): Promise<T>;
  deleteItem(id: string): Promise<void>;
}

interface ResourceStoreState<T extends { id: string }> {
  items: T[];
  listeners: Set<() => void>;
  error: unknown;
  pendingCount: number;
  resolvedOnce: boolean;
  inFlightLoad: Promise<T[]> | null;
  nextId: number;
}

const resourceStores = new Map<string, ResourceStore<any>>();
const resourceClientIds = new WeakMap<object, number>();
let nextClientId = 1;

function storeKey(client: ResourceClient, api: string): string {
  const resourceClient = client as object;
  let id = resourceClientIds.get(resourceClient);
  if (!id) {
    id = nextClientId;
    nextClientId += 1;
    resourceClientIds.set(resourceClient, id);
  }
  return `${id}:${api}`;
}

function notifyState<T extends { id: string }>(state: ResourceStoreState<T>): void {
  for (const listener of state.listeners) {
    listener();
  }
}

function resourceLeaf(api: string): string {
  const parts = api.split('/').filter(Boolean);
  return parts[parts.length - 1] ?? 'record';
}

function syncNextId<T extends { id: string }>(api: string, state: ResourceStoreState<T>): void {
  const prefix = `${resourceLeaf(api)}-`;
  let max = 0;
  for (const item of state.items) {
    if (!item.id.startsWith(prefix)) continue;
    const suffix = Number(item.id.slice(prefix.length));
    if (Number.isFinite(suffix) && suffix > max) {
      max = suffix;
    }
  }
  state.nextId = max + 1;
}

function createSyntheticId<T extends { id: string }>(api: string, state: ResourceStoreState<T>): string {
  const id = `${resourceLeaf(api)}-${state.nextId}`;
  state.nextId += 1;
  return id;
}

function createResourceStore<T extends { id: string }>(client: ResourceClient, api: string): ResourceStore<T> {
  const state: ResourceStoreState<T> = {
    items: [],
    listeners: new Set(),
    error: null,
    pendingCount: 0,
    resolvedOnce: false,
    inFlightLoad: null,
    nextId: 1,
  };

  async function runMutation<R>(mutate: () => Promise<R>): Promise<R> {
    state.pendingCount += 1;
    state.error = null;
    notifyState(state);
    try {
      const result = await mutate();
      state.resolvedOnce = true;
      return result;
    } catch (error) {
      state.error = error;
      state.resolvedOnce = true;
      throw error;
    } finally {
      state.pendingCount = Math.max(0, state.pendingCount - 1);
      notifyState(state);
    }
  }

  return {
    subscribe(listener) {
      state.listeners.add(listener);
      return () => {
        state.listeners.delete(listener);
      };
    },

    getSnapshot() {
      return {
        items: state.items,
        error: state.error,
        pendingCount: state.pendingCount,
        resolvedOnce: state.resolvedOnce,
      };
    },

    getById(id) {
      return state.items.find((item) => item.id === id);
    },

    load(force = false) {
      if (!force && state.resolvedOnce && !state.error) {
        return Promise.resolve(state.items);
      }
      if (state.inFlightLoad) {
        return state.inFlightLoad;
      }

      state.pendingCount += 1;
      state.error = null;
      notifyState(state);

      state.inFlightLoad = client.list<T>(api)
        .then((items) => {
          state.items = [...items];
          state.error = null;
          state.resolvedOnce = true;
          syncNextId(api, state);
          return state.items;
        })
        .catch((error) => {
          state.error = error;
          state.resolvedOnce = true;
          throw error;
        })
        .finally(() => {
          state.pendingCount = Math.max(0, state.pendingCount - 1);
          state.inFlightLoad = null;
          notifyState(state);
        });

      return state.inFlightLoad;
    },

    createItem(input) {
      return runMutation(async () => {
        const created = await client.create<T>(api, input);
        const nextRecord = {
          ...created,
          id: String(created.id ?? createSyntheticId(api, state)),
        } as T;
        state.items = [...state.items, nextRecord];
        syncNextId(api, state);
        return nextRecord;
      });
    },

    updateItem(id, input) {
      return runMutation(async () => {
        const current = state.items.find((item) => item.id === id);
        const updated = await client.update<T>(api, id, input);
        const nextRecord = {
          ...current,
          ...input,
          ...updated,
          id: String(updated.id ?? id),
        } as T;
        state.items = state.items.map((item) => item.id === id ? nextRecord : item);
        return nextRecord;
      });
    },

    deleteItem(id) {
      return runMutation(async () => {
        await client.delete(api, id);
        state.items = state.items.filter((item) => item.id !== id);
      });
    },
  };
}

export function getResourceStore<T extends { id: string }>(
  client: ResourceClient,
  api: string,
): ResourceStore<T> {
  const key = storeKey(client, api);
  const existing = resourceStores.get(key);
  if (existing) return existing as ResourceStore<T>;
  const created = createResourceStore<T>(client, api);
  resourceStores.set(key, created);
  return created;
}

export function resetResourceStoreTestState(): void {
  resourceStores.clear();
  nextClientId = 1;
}
