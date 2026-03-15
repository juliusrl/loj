import { describe, expect, it } from 'vitest';
import { can } from '../src/policies/can.js';

describe('can', () => {
  it('evaluates hasRole rules', () => {
    expect(can(
      {
        source: 'builtin',
        expr: {
          type: 'call',
          fn: 'hasRole',
          args: [
            { type: 'identifier', path: ['currentUser'] },
            { type: 'literal', value: 'admin' },
          ],
        },
      },
      { currentUser: { role: 'admin' } },
    )).toBe(true);
  });

  it('evaluates composite boolean expressions', () => {
    expect(can(
      {
        source: 'builtin',
        expr: {
          type: 'binary',
          op: '&&',
          left: {
            type: 'binary',
            op: '==',
            left: { type: 'identifier', path: ['currentUser', 'role'] },
            right: { type: 'literal', value: 'admin' },
          },
          right: {
            type: 'binary',
            op: '==',
            left: { type: 'identifier', path: ['record', 'status'] },
            right: { type: 'literal', value: 'active' },
          },
        },
      },
      {
        currentUser: { role: 'admin' },
        record: { status: 'active' },
      },
    )).toBe(true);
  });

  it('fails closed for unsupported rule shapes', () => {
    expect(can({ source: 'escape-fn' }, { currentUser: { role: 'admin' } })).toBe(false);
    expect(can(null, {})).toBe(false);
  });
});
