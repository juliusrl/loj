import { describe, expect, it } from 'vitest';
import {
  buildRulesManifestFileName,
  countRulesEntries,
  compileRulesSource,
} from '../src/rules-proof.js';

describe('rules proof compiler', () => {
  it('compiles a .rules.loj source into a semantic manifest', () => {
    const result = compileRulesSource(`
rules invoice-access:
  allow list:
    when: currentUser.role in [ADMIN, FINANCE, SALES]
    scopeWhen: currentUser.role == SALES
    scope: record.accountManagerId == currentUser.id

  allow update:
    when: currentUser.role == ADMIN
    or:
      - currentUser.id == record.accountManagerId

  deny delete:
    when: record.status == COMPLETED
    message:
      key: "invoice.delete.completed"
      defaultMessage: "Completed invoices cannot be deleted."
`, 'policies/invoice-access.rules.loj');

    expect(result.success).toBe(true);
    expect(result.program?.name).toBe('invoice-access');
    expect(result.program?.rules).toHaveLength(3);
    expect(result.program?.eligibility).toHaveLength(0);
    expect(result.program?.validation).toHaveLength(0);
    expect(result.program?.derivations).toHaveLength(0);
    expect(result.manifest?.artifact).toBe('loj.rules.manifest');
    expect(result.manifest?.schemaVersion).toBe(2);
    expect(result.manifest?.rules[0].operation).toBe('list');
    expect(result.manifest?.rules[0].scopeWhen).toBeDefined();
    expect(result.manifest?.rules[0].scope).toBeDefined();
    expect(result.manifest?.rules[1].or).toHaveLength(1);
  });

  it('compiles eligibility, validation, and derive entries into grouped manifest sections', () => {
    const result = compileRulesSource(`
rules booking-logic:
  eligibility create-booking:
    when: currentUser.role in [ADMIN, AGENT]
    message:
      defaultMessage: "Booking create is not allowed."

  validate passenger-count:
    when: count(payload.passengers) > 0
    message:
      defaultMessage: "At least one passenger is required."

  derive quotedPrice:
    when: input.passengerCount > 0
    value: item.basePrice * input.passengerCount
`, 'rules/booking-logic.rules.loj');

    expect(result.success).toBe(true);
    expect(result.program?.rules).toHaveLength(0);
    expect(result.program?.eligibility).toHaveLength(1);
    expect(result.program?.validation).toHaveLength(1);
    expect(result.program?.derivations).toHaveLength(1);
    expect(result.manifest?.eligibility).toHaveLength(1);
    expect(result.manifest?.validation).toHaveLength(1);
    expect(result.manifest?.derivations).toHaveLength(1);
    expect(result.manifest?.derivations[0].field).toBe('quotedPrice');
    expect(countRulesEntries(result.program!)).toBe(3);
  });

  it('rejects scoped conditions on non-list entries', () => {
    const result = compileRulesSource(`
rules invoice-access:
  allow update:
    when: currentUser.role == ADMIN
    scopeWhen: currentUser.role == SALES
    scope: record.accountManagerId == currentUser.id
`, 'policies/invoice-access.rules.loj');

    expect(result.success).toBe(false);
    expect(result.errors.some((error) => error.message.includes('scopeWhen/scope only for list'))).toBe(true);
  });

  it('derives manifest file names from .rules.loj sources', () => {
    expect(buildRulesManifestFileName('policies/invoice-access.rules.loj')).toBe('invoice-access.rules.manifest.json');
  });
});
