import React from 'react';

export interface ResourceClient {
  get<T>(path: string): Promise<T>;
  list<T extends { id: string }>(api: string): Promise<T[]>;
  create<T extends { id: string }>(api: string, input: Partial<T>): Promise<T>;
  update<T extends { id: string }>(api: string, id: string, input: Partial<T>): Promise<T>;
  delete(api: string, id: string): Promise<void>;
  post<T>(path: string, input?: unknown): Promise<T>;
}

export interface ResourceProviderProps {
  client: ResourceClient;
  children?: React.ReactNode;
}

export interface FetchResourceClientOptions {
  baseUrl?: string;
  headers?: HeadersInit | (() => HeadersInit | Promise<HeadersInit>);
  credentials?: RequestCredentials;
  fetch?: typeof fetch;
}

interface ResponseLike {
  ok: boolean;
  status: number;
  text(): Promise<string>;
}

interface MemoryCollection {
  items: Array<{ id: string; [key: string]: unknown }>;
  nextId: number;
}

const ResourceClientContext = React.createContext<ResourceClient | undefined>(undefined);
const memoryCollections = new Map<string, MemoryCollection>();
const fetchClientCache = new Map<string, ResourceClient>();
let sameOriginFetchClient: ResourceClient | null = null;
let defaultMemoryClient: ResourceClient | null = null;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function resourceLeaf(api: string): string {
  const parts = api.split('/').filter(Boolean);
  return parts[parts.length - 1] ?? 'record';
}

function createSyntheticId(api: string, collection: MemoryCollection): string {
  const id = `${resourceLeaf(api)}-${collection.nextId}`;
  collection.nextId += 1;
  return id;
}

function ensureMemoryCollection(api: string): MemoryCollection {
  const existing = memoryCollections.get(api);
  if (existing) return existing;
  const created: MemoryCollection = {
    items: [],
    nextId: 1,
  };
  memoryCollections.set(api, created);
  return created;
}

function withStringId<T extends { id: string }>(
  payload: unknown,
  api: string,
  operation: string,
): T {
  if (!isRecord(payload) || payload.id === undefined || payload.id === null) {
    throw new Error(`Invalid ${operation} response for ${api}: expected a record with an id`);
  }
  return {
    ...payload,
    id: String(payload.id),
  } as T;
}

export function normalizeListPayload<T extends { id: string }>(
  payload: unknown,
  api: string,
): T[] {
  const items = Array.isArray(payload)
    ? payload
    : isRecord(payload) && Array.isArray(payload.items)
      ? payload.items
      : isRecord(payload) && Array.isArray(payload.data)
        ? payload.data
        : null;

  if (!items) {
    throw new Error(`Invalid list response for ${api}: expected an array or { items: [] }`);
  }

  return items.map((item) => withStringId<T>(item, api, 'list'));
}

export function normalizeRecordPayload<T extends { id: string }>(
  payload: unknown,
  api: string,
  operation: string,
): T {
  const record = isRecord(payload) && isRecord(payload.item)
    ? payload.item
    : isRecord(payload) && isRecord(payload.data)
      ? payload.data
      : payload;

  return withStringId<T>(record, api, operation);
}

async function resolveHeaders(
  headers?: FetchResourceClientOptions['headers'],
): Promise<HeadersInit | undefined> {
  if (!headers) return undefined;
  return typeof headers === 'function' ? await headers() : headers;
}

function mergeHeaders(...headerSets: Array<HeadersInit | undefined>): Headers {
  const merged = new Headers();
  for (const headerSet of headerSets) {
    if (!headerSet) continue;
    const next = new Headers(headerSet);
    next.forEach((value, key) => {
      merged.set(key, value);
    });
  }
  return merged;
}

function resolveResourceUrl(api: string, baseUrl?: string): string {
  if (/^https?:\/\//i.test(api)) return api;
  if (!baseUrl || baseUrl.trim() === '') return api;
  const normalizedBase = baseUrl.trim();
  if (!/^https?:\/\//i.test(normalizedBase)) {
    return api;
  }
  const absoluteBase = normalizedBase.endsWith('/') ? normalizedBase : `${normalizedBase}/`;
  return new URL(api.startsWith('/') ? api.slice(1) : api, absoluteBase).toString();
}

async function readJsonPayload(response: ResponseLike, api: string, method: string): Promise<unknown> {
  const text = await response.text();
  if (text.trim() === '') return undefined;
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(
      `Invalid JSON response for ${method} ${api}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export function createFetchResourceClient(options: FetchResourceClientOptions = {}): ResourceClient {
  const fetchImpl = options.fetch ?? globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    throw new Error('Fetch is not available; provide options.fetch or use ResourceProvider with a custom client');
  }

  async function request(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    api: string,
    init: RequestInit = {},
  ): Promise<unknown> {
    const requestHeaders = mergeHeaders(
      await resolveHeaders(options.headers),
      init.headers,
    );

    const response = await fetchImpl(resolveResourceUrl(api, options.baseUrl), {
      ...init,
      method,
      credentials: options.credentials,
      headers: requestHeaders,
    });

    const payload = await readJsonPayload(response as ResponseLike, api, method);
    if (!response.ok) {
      const detail = isRecord(payload) && typeof payload.message === 'string'
        ? `: ${payload.message}`
        : '';
      throw new Error(`${method} ${api} failed with ${response.status}${detail}`);
    }
    return payload;
  }

  return {
    async get<T>(path: string) {
      const payload = await request('GET', path);
      return payload as T;
    },
    async list<T extends { id: string }>(api: string) {
      const payload = await request('GET', api);
      return normalizeListPayload<T>(payload, api);
    },
    async create<T extends { id: string }>(api: string, input: Partial<T>) {
      const payload = await request('POST', api, {
        body: JSON.stringify(input),
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
      });
      return normalizeRecordPayload<T>(payload, api, 'create');
    },
    async update<T extends { id: string }>(api: string, id: string, input: Partial<T>) {
      const payload = await request('PUT', `${api}/${encodeURIComponent(id)}`, {
        body: JSON.stringify(input),
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
      });
      if (payload === undefined) {
        return {
          ...input,
          id: String(id),
        } as T;
      }
      return normalizeRecordPayload<T>(payload, api, 'update');
    },
    async delete(api: string, id: string) {
      await request('DELETE', `${api}/${encodeURIComponent(id)}`);
    },
    async post<T>(path: string, input?: unknown) {
      const payload = await request('POST', path, {
        body: input === undefined ? undefined : JSON.stringify(input),
        headers: {
          Accept: 'application/json',
          ...(input === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
      });
      return payload as T;
    },
  };
}

export function createMemoryResourceClient(): ResourceClient {
  return {
    async get<T>(path: string) {
      const [collectionPath] = path.split('?');
      return ensureMemoryCollection(collectionPath).items.map((item) => ({ ...item })) as T;
    },
    async list<T extends { id: string }>(api: string) {
      return ensureMemoryCollection(api).items.map((item) => ({ ...item })) as T[];
    },
    async create<T extends { id: string }>(api: string, input: Partial<T>) {
      const collection = ensureMemoryCollection(api);
      const nextRecord = {
        ...input,
        id: String(input.id ?? createSyntheticId(api, collection)),
      } as T;
      collection.items = [...collection.items, nextRecord];
      return { ...nextRecord };
    },
    async update<T extends { id: string }>(api: string, id: string, input: Partial<T>) {
      const collection = ensureMemoryCollection(api);
      const current = collection.items.find((item) => item.id === id);
      if (!current) {
        throw new Error(`Record not found: ${id}`);
      }
      const nextRecord = {
        ...current,
        ...input,
        id,
      } as T;
      collection.items = collection.items.map((item) => item.id === id ? nextRecord : item);
      return { ...nextRecord };
    },
    async delete(api: string, id: string) {
      const collection = ensureMemoryCollection(api);
      collection.items = collection.items.filter((item) => item.id !== id);
    },
    async post<T>(_path: string, _input?: unknown) {
      throw new Error('Memory resource client does not support custom POST actions');
    },
  };
}

function readGlobalResourceClient(): ResourceClient | undefined {
  if (typeof window === 'undefined') return undefined;
  const value = (window as unknown as { __RDSL_RESOURCE_CLIENT__?: ResourceClient }).__RDSL_RESOURCE_CLIENT__;
  return value && typeof value === 'object' ? value : undefined;
}

function readGlobalApiBase(): string | undefined {
  if (typeof window === 'undefined') return undefined;
  const value = (window as unknown as { __RDSL_API_BASE__?: unknown }).__RDSL_API_BASE__;
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}

function getDefaultResourceClient(): ResourceClient {
  const globalBase = readGlobalApiBase();
  if (globalBase) {
    const existing = fetchClientCache.get(globalBase);
    if (existing) return existing;
    const created = createFetchResourceClient({ baseUrl: globalBase });
    fetchClientCache.set(globalBase, created);
    return created;
  }

  if (typeof globalThis.fetch === 'function') {
    if (!sameOriginFetchClient) {
      sameOriginFetchClient = createFetchResourceClient();
    }
    return sameOriginFetchClient;
  }

  if (!defaultMemoryClient) {
    defaultMemoryClient = createMemoryResourceClient();
  }
  return defaultMemoryClient;
}

export function ResourceProvider({ client, children }: ResourceProviderProps) {
  return React.createElement(ResourceClientContext.Provider, { value: client }, children);
}

export function useResourceClient(): ResourceClient {
  return React.useContext(ResourceClientContext)
    ?? readGlobalResourceClient()
    ?? getDefaultResourceClient();
}

export function resetResourceClientTestState(): void {
  memoryCollections.clear();
  fetchClientCache.clear();
  sameOriginFetchClient = null;
  defaultMemoryClient = null;
}
