import { describe, expect, it } from 'vitest';
import { matchesResourceTarget } from '../src/hooks/resourceTarget.js';

describe('matchesResourceTarget', () => {
  it('matches resource leaf names and resource-qualified targets', () => {
    expect(matchesResourceTarget('/api/users', 'users')).toBe(true);
    expect(matchesResourceTarget('/api/users', 'users.list')).toBe(true);
    expect(matchesResourceTarget('/api/users', 'resource.users.list')).toBe(true);
    expect(matchesResourceTarget('/api/users', '/api/users')).toBe(true);
  });

  it('does not match unrelated targets', () => {
    expect(matchesResourceTarget('/api/users', 'orders')).toBe(false);
    expect(matchesResourceTarget('/api/users', '')).toBe(false);
    expect(matchesResourceTarget('/api/users', null)).toBe(false);
  });
});
