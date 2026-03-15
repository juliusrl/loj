import { describe, expect, it } from 'vitest';
import {
  buildFlowManifestFileName,
  compileFlowSource,
} from '../src/flow-proof.js';

describe('flow proof compiler', () => {
  it('compiles a .flow.loj source into a semantic manifest', () => {
    const result = compileFlowSource(`
workflow booking-process:
  model: Booking
  field: status

  states:
    DRAFT:
      label: "Draft"
      color: gray
    READY:
      label: "Ready"
      color: blue
    CONFIRMED:
      label: "Confirmed"
      color: green

  wizard:
    steps:
      - name: select-flight
        completesWith: DRAFT
        surface: form
      - name: enter-passengers
        completesWith: READY
        surface: read
        allow: currentUser.role in [ADMIN, AGENT]

  transitions:
    confirm:
      from: READY
      to: CONFIRMED
      allow: currentUser.role == ADMIN
`, 'workflows/booking-process.flow.loj');

    expect(result.success).toBe(true);
    expect(result.program?.name).toBe('booking-process');
    expect(result.program?.states).toHaveLength(3);
    expect(result.program?.wizard?.steps).toHaveLength(2);
    expect(result.program?.wizard?.steps[0]?.surface).toBe('form');
    expect(result.program?.wizard?.steps[1]?.surface).toBe('read');
    expect(result.program?.transitions).toHaveLength(1);
    expect(result.manifest?.artifact).toBe('loj.flow.manifest');
    expect(result.manifest?.wizard?.steps[0]?.surface).toBe('form');
    expect(result.manifest?.wizard?.steps[1]?.surface).toBe('read');
    expect(result.manifest?.transitions[0].from).toEqual(['READY']);
  });

  it('derives manifest file names from .flow.loj sources', () => {
    expect(buildFlowManifestFileName('workflows/booking-process.flow.loj')).toBe('booking-process.flow.manifest.json');
  });

  it('defaults wizard step surfaces to form for the first step and workflow afterwards', () => {
    const result = compileFlowSource(`
workflow booking-process:
  model: Booking
  field: status

  states:
    DRAFT:
      label: "Draft"
    READY:
      label: "Ready"

  wizard:
    steps:
      - name: capture-booking
        completesWith: DRAFT
      - name: issue-ticket
        completesWith: READY

  transitions:
    confirm:
      from: DRAFT
      to: READY
`, 'workflows/booking-process.flow.loj');

    expect(result.success).toBe(true);
    expect(result.program?.wizard?.steps.map((step) => step.surface)).toEqual(['form', 'workflow']);
    expect(result.manifest?.wizard?.steps.map((step) => step.surface)).toEqual(['form', 'workflow']);
  });
});
