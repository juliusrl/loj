import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryResourceClient, resetResourceClientTestState } from '../src/hooks/resourceClient.js';
import { getResourceStore, resetResourceStoreTestState } from '../src/hooks/resourceStore.js';

describe('resource store', () => {
  beforeEach(() => {
    resetResourceClientTestState();
    resetResourceStoreTestState();
  });

  it('deduplicates concurrent list loads per client/api pair', async () => {
    const list = vi.fn(async () => {
      await Promise.resolve();
      return [{ id: '1', name: 'Ada' }];
    });
    const client = {
      get: vi.fn(),
      list,
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    };

    const store = getResourceStore<{ id: string; name: string }>(client, '/api/users');
    const first = store.load();
    const second = store.load();

    expect(first).toBe(second);
    await expect(first).resolves.toEqual([{ id: '1', name: 'Ada' }]);
    expect(list).toHaveBeenCalledTimes(1);
    expect(store.getById('1')).toEqual({ id: '1', name: 'Ada' });
  });

  it('updates cached records after create, update, and delete', async () => {
    const client = createMemoryResourceClient();
    const store = getResourceStore<{ id: string; name: string }>(client, '/api/users');

    await store.load();
    const created = await store.createItem({ name: 'Ada' });
    expect(created).toEqual({ id: 'users-1', name: 'Ada' });
    expect(store.getById('users-1')).toEqual({ id: 'users-1', name: 'Ada' });

    const updated = await store.updateItem('users-1', { name: 'Ada Lovelace' });
    expect(updated).toEqual({ id: 'users-1', name: 'Ada Lovelace' });

    await store.deleteItem('users-1');
    expect(store.getById('users-1')).toBeUndefined();
  });

  it('records load failures without staying stuck in loading state', async () => {
    const client = {
      get: vi.fn(),
      list: vi.fn(async () => {
        throw new Error('boom');
      }),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    };

    const store = getResourceStore<{ id: string; name: string }>(client, '/api/users');
    await expect(store.load()).rejects.toThrow('boom');
    expect(store.getSnapshot()).toMatchObject({
      error: expect.any(Error),
      pendingCount: 0,
      resolvedOnce: true,
    });
  });
});
