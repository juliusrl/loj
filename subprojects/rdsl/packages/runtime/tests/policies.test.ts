import { describe, expect, it } from 'vitest';
import {
  evaluatePolicyExpr,
  firstPolicyFailure,
  matchesPolicyRule,
  resolvePolicyMessage,
} from '../src/policies/can.js';

describe('policy helpers', () => {
  it('evaluates linked-rules expressions against input and item context', () => {
    expect(
      evaluatePolicyExpr(
        { type: 'binary', op: '==', left: { type: 'identifier', path: ['input', 'cabin'] }, right: { type: 'literal', value: 'business' } },
        { input: { cabin: 'business' } },
      ),
    ).toBe(true);

    expect(
      evaluatePolicyExpr(
        { type: 'binary', op: '+', left: { type: 'identifier', path: ['item', 'fare'] }, right: { type: 'literal', value: 20 } },
        { item: { fare: 180 } },
      ),
    ).toBe(200);
  });

  it('matches grouped rules and resolves first failure messages', () => {
    const rules = [
      {
        when: { type: 'binary', op: '==', left: { type: 'identifier', path: ['currentUser', 'role'] }, right: { type: 'literal', value: 'agent' } },
        message: {
          key: 'search.role.denied',
          defaultMessage: 'Only agents may search business fares',
        },
      },
      {
        when: { type: 'binary', op: '!=', left: { type: 'identifier', path: ['input', 'from'] }, right: { type: 'literal', value: '' } },
        or: [
          { type: 'binary', op: '!=', left: { type: 'identifier', path: ['input', 'to'] }, right: { type: 'literal', value: '' } },
        ],
        message: 'Origin or destination is required',
      },
    ];

    expect(matchesPolicyRule(rules[0], { currentUser: { role: 'agent' } })).toBe(true);
    expect(firstPolicyFailure(rules, { currentUser: { role: 'viewer' }, input: { from: '', to: '' } }, 'Forbidden')).toBe('Only agents may search business fares');
    expect(firstPolicyFailure(rules, { currentUser: { role: 'agent' }, input: { from: '', to: '' } }, 'Forbidden')).toBe('Origin or destination is required');
    expect(firstPolicyFailure(rules, { currentUser: { role: 'agent' }, input: { from: 'HND', to: '' } }, 'Forbidden')).toBeNull();
  });

  it('falls back to descriptor key or explicit fallback when needed', () => {
    expect(resolvePolicyMessage({ message: { key: 'rules.invalid' } }, 'Invalid request')).toBe('rules.invalid');
    expect(
      resolvePolicyMessage({
        message: {
          defaultMessage: 'Blocked route for {origin}',
          values: { origin: 'HND' },
        },
      }, 'Invalid request'),
    ).toBe('Blocked route for HND');
    expect(resolvePolicyMessage({}, 'Invalid request')).toBe('Invalid request');
  });
});
