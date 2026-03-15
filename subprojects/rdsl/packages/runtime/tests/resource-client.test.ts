import { beforeEach, describe, expect, it } from 'vitest';
import {
  createFetchResourceClient,
  createMemoryResourceClient,
  normalizeListPayload,
  normalizeRecordPayload,
  resetResourceClientTestState,
} from '../src/hooks/resourceClient.js';

interface FetchCall {
  input: string;
  init?: RequestInit;
}

function createFetchMock(
  responses: Array<{ status?: number; body?: unknown }>,
): { fetchMock: typeof fetch; calls: FetchCall[] } {
  const calls: FetchCall[] = [];
  const fetchMock = (async (input: string | URL | Request, init?: RequestInit) => {
    const next = responses.shift();
    if (!next) {
      throw new Error('Unexpected fetch call');
    }
    calls.push({
      input: typeof input === 'string' ? input : String(input),
      init,
    });
    return {
      ok: (next.status ?? 200) >= 200 && (next.status ?? 200) < 300,
      status: next.status ?? 200,
      async text() {
        return next.body === undefined ? '' : JSON.stringify(next.body);
      },
    } as Response;
  }) as typeof fetch;
  return { fetchMock, calls };
}

describe('resource client', () => {
  beforeEach(() => {
    resetResourceClientTestState();
  });

  it('normalizes common list and record payload shapes', () => {
    expect(normalizeListPayload([{ id: 1, name: 'Ada' }], '/api/users')).toEqual([
      { id: '1', name: 'Ada' },
    ]);
    expect(normalizeListPayload({ items: [{ id: '2', name: 'Linus' }] }, '/api/users')).toEqual([
      { id: '2', name: 'Linus' },
    ]);
    expect(normalizeRecordPayload({ data: { id: 3, name: 'Grace' } }, '/api/users', 'create')).toEqual({
      id: '3',
      name: 'Grace',
    });
  });

  it('builds a fetch-backed REST client with baseUrl and JSON headers', async () => {
    const { fetchMock, calls } = createFetchMock([
      { body: { items: [{ code: 'HND' }] } },
      { body: [{ id: 1, name: 'Ada' }] },
      { body: { data: { id: 2, name: 'Grace' } } },
      { status: 204 },
      { status: 204 },
    ]);

    const client = createFetchResourceClient({
      baseUrl: 'http://localhost:3001',
      headers: { Authorization: 'Bearer token' },
      fetch: fetchMock,
    });

    await expect(client.get<{ items: Array<{ code: string }> }>('/api/flights/search?from=HND')).resolves.toEqual({
      items: [{ code: 'HND' }],
    });
    await expect(client.list<{ id: string; name: string }>('/api/users')).resolves.toEqual([
      { id: '1', name: 'Ada' },
    ]);
    await expect(
      client.create<{ id: string; name: string }>('/api/users', { name: 'Grace' }),
    ).resolves.toEqual({ id: '2', name: 'Grace' });
    await expect(
      client.update<{ id: string; name: string }>('/api/users', '2', { name: 'Grace Hopper' }),
    ).resolves.toEqual({ id: '2', name: 'Grace Hopper' });
    await expect(client.delete('/api/users', '2')).resolves.toBeUndefined();

    expect(calls.map((call) => call.input)).toEqual([
      'http://localhost:3001/api/flights/search?from=HND',
      'http://localhost:3001/api/users',
      'http://localhost:3001/api/users',
      'http://localhost:3001/api/users/2',
      'http://localhost:3001/api/users/2',
    ]);

    const createHeaders = new Headers(calls[2]?.init?.headers);
    expect(createHeaders.get('authorization')).toBe('Bearer token');
    expect(createHeaders.get('content-type')).toBe('application/json');
  });

  it('keeps same-origin resource paths untouched when baseUrl is path-shaped for proxy mode', async () => {
    const { fetchMock, calls } = createFetchMock([
      { body: { items: [] } },
    ]);

    const client = createFetchResourceClient({
      baseUrl: '/api',
      fetch: fetchMock,
    });

    await expect(client.list('/api/users')).resolves.toEqual([]);
    expect(calls.map((call) => call.input)).toEqual(['/api/users']);
  });

  it('falls back to a memory-backed client when needed', async () => {
    const client = createMemoryResourceClient();

    await expect(client.create('/api/users', { name: 'Ada' })).resolves.toEqual({
      id: 'users-1',
      name: 'Ada',
    });
    await expect(client.get('/api/users?name=Ada')).resolves.toEqual([
      { id: 'users-1', name: 'Ada' },
    ]);
    await expect(client.list('/api/users')).resolves.toEqual([
      { id: 'users-1', name: 'Ada' },
    ]);
  });
});
