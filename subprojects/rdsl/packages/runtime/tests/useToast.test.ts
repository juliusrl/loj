import { describe, expect, it } from 'vitest';
import { resolveToastMessage } from '../src/hooks/useToast.js';

describe('resolveToastMessage', () => {
  it('returns plain strings unchanged', () => {
    expect(resolveToastMessage('Saved')).toBe('Saved');
  });

  it('falls back to defaultMessage for descriptors', () => {
    expect(resolveToastMessage({
      key: 'users.saved',
      defaultMessage: 'User saved',
    })).toBe('User saved');
  });

  it('interpolates descriptor values into defaultMessage', () => {
    expect(resolveToastMessage({
      key: 'users.created',
      defaultMessage: 'Created {count} users for {org}',
      values: {
        count: 3,
        org: 'Acme',
      },
    })).toBe('Created 3 users for Acme');
  });

  it('falls back to the message key when no defaultMessage exists', () => {
    expect(resolveToastMessage({
      key: 'users.saved',
    })).toBe('users.saved');
  });
});
