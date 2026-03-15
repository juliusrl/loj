import { describe, expect, it } from 'vitest';

import { isMessageDescriptor, resolveMessageText } from '../src/index.js';

describe('message contracts', () => {
  it('detects descriptor-shaped values', () => {
    expect(isMessageDescriptor({ key: 'users.saved' })).toBe(true);
    expect(isMessageDescriptor({ defaultMessage: 'Saved' })).toBe(true);
    expect(isMessageDescriptor('Saved')).toBe(false);
  });

  it('resolves strings, descriptor fallbacks, and interpolated values', () => {
    expect(resolveMessageText('Saved', 'Fallback')).toBe('Saved');
    expect(resolveMessageText({ key: 'users.saved' }, 'Fallback')).toBe('users.saved');
    expect(
      resolveMessageText({
        defaultMessage: 'Saved {count} users for {org}',
        values: { count: 2, org: 'Acme' },
      }, 'Fallback'),
    ).toBe('Saved 2 users for Acme');
  });

  it('falls back when descriptor content is missing', () => {
    expect(resolveMessageText({}, 'Fallback')).toBe('Fallback');
  });

  it('exports reusable seed contracts for shared handoff shapes', () => {
    const rowSeed = { row: 'fareBrand' };
    const pageSeed = { selection: 'outboundFlights.id' };
    const handoff = {
      resource: 'bookings',
      label: 'Create Booking',
      seed: {
        outwardFareBrand: rowSeed,
        outwardFlightId: pageSeed,
      },
    };

    expect(rowSeed.row).toBe('fareBrand');
    expect(pageSeed.selection).toBe('outboundFlights.id');
    expect(handoff.resource).toBe('bookings');
  });

  it('exports reusable read-model page contracts', () => {
    const consumer = {
      queryState: 'availabilitySearch',
      selectionState: 'outboundFlights',
      dateNavigation: {
        field: 'travelDate',
        prevLabel: 'Previous day',
        nextLabel: 'Next day',
      },
    };

    expect(consumer.queryState).toBe('availabilitySearch');
    expect(consumer.dateNavigation.field).toBe('travelDate');
  });

  it('exports reusable workflow summary contracts', () => {
    const summary = {
      field: 'status',
      currentState: 'CONFIRMED',
      currentStateLabel: 'Confirmed',
      workflowHref: '/bookings/1/workflow',
      steps: [{ name: 'review', status: 'current' as const, completesWith: 'CONFIRMED', surface: 'read' as const }],
      transitions: [{ name: 'fail_ticketing', to: 'FAILED', toLabel: 'Failed' }],
    };

    expect(summary.steps[0].status).toBe('current');
    expect(summary.steps[0].surface).toBe('read');
    expect(summary.transitions[0].toLabel).toBe('Failed');
  });

  it('exports reusable workflow meta contracts', () => {
    const step = {
      name: 'review',
      completesWith: 'READY',
      surface: 'read' as const,
      allow: { role: 'agent' },
    };
    const transition = {
      name: 'ticket',
      from: ['READY'],
      to: 'TICKETED',
    };
    const state = {
      name: 'TICKETED',
      label: 'Ticketed',
      color: 'green',
    };

    expect(step.completesWith).toBe('READY');
    expect(transition.from[0]).toBe('READY');
    expect(state.color).toBe('green');
  });

  it('exports reusable workflow progress and map contracts', () => {
    const progress = {
      stateHeading: 'Current state',
      stateLabel: 'Ready',
      currentStepName: 'review',
      nextStepName: 'ticket',
      steps: [{ name: 'review', status: 'current' as const }],
    };
    const transitionTargets = {
      confirm: 'READY',
      ticket: 'TICKETED',
    };
    const stateLabels = {
      READY: 'Ready',
      TICKETED: 'Ticketed',
    };

    expect(progress.nextStepName).toBe('ticket');
    expect(transitionTargets.ticket).toBe('TICKETED');
    expect(stateLabels.READY).toBe('Ready');
  });

  it('exports reusable relation summary contracts', () => {
    const relation = {
      field: 'passengers',
      title: 'Passengers',
      surfaceKind: 'table' as const,
      targetResource: 'passengers',
      targetModel: 'Passenger',
      count: 2,
      items: [
        {
          id: 'p_1',
          label: 'Ada Lovelace',
          viewHref: '/passengers/p_1',
          editHref: '/passengers/p_1/edit',
          workflowHref: null,
          workflowStateLabel: null,
        },
      ],
      createHref: '/passengers/create',
      loading: false,
      error: false,
    };

    expect(relation.surfaceKind).toBe('table');
    expect(relation.items?.[0]?.label).toBe('Ada Lovelace');
  });

  it('exports reusable record-scoped custom block context contracts', () => {
    const context = {
      recordId: 'booking_1',
      returnTo: '/availability',
      backHref: '/bookings/booking_1',
      parentReadHref: '/bookings/booking_1',
      parentEditHref: '/bookings/booking_1/edit',
      parentRecord: { id: 'booking_1', reference: 'BK-001' },
      parentLoading: false,
      parentError: false,
      parentWorkflow: {
        field: 'status',
        currentState: 'READY',
        currentStateLabel: 'Ready',
        workflowHref: '/bookings/booking_1/workflow',
        steps: [{ name: 'confirm', status: 'current' as const }],
        transitions: [{ name: 'ticket', to: 'TICKETED', toLabel: 'Ticketed' }],
      },
      relations: [],
    };

    expect(context.parentWorkflow?.currentStateLabel).toBe('Ready');
    expect(context.parentRecord?.reference).toBe('BK-001');
  });
});
