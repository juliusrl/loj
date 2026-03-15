import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  configureAppBasePath,
  getConfiguredAppBasePath,
  getCurrentAppPathname,
  getSanitizedReturnTo,
  getLocationSearchValues,
  prefixAppBasePath,
  replaceLocationSearchValues,
  sanitizeAppLocalHref,
  shiftDateInputValue,
  stripAppBasePath,
} from '../src/hooks/navigation.js';

describe('navigation helpers', () => {
  const originalWindow = globalThis.window;

  beforeEach(() => {
    configureAppBasePath('/');
    const location = {
      pathname: '/',
      search: '',
      hash: '',
    };
    const history = {
      state: {},
      replaceState: (_state: unknown, _title: string, href: string) => {
        const url = new URL(href, 'https://example.test');
        history.state = _state;
        location.pathname = url.pathname;
        location.search = url.search;
        location.hash = url.hash;
      },
    };
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: { location, history },
    });
    window.history.replaceState({}, '', '/');
  });

  afterEach(() => {
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: originalWindow,
    });
  });

  it('sanitizes only app-local hrefs', () => {
    expect(sanitizeAppLocalHref('/bookings/1')).toBe('/bookings/1');
    expect(sanitizeAppLocalHref('/bookings/1?tab=workflow')).toBe('/bookings/1?tab=workflow');
    expect(sanitizeAppLocalHref('//evil.example')).toBeNull();
    expect(sanitizeAppLocalHref('https://evil.example')).toBeNull();
    expect(sanitizeAppLocalHref('bookings/1')).toBeNull();
    expect(sanitizeAppLocalHref(null)).toBeNull();
  });

  it('prefixes and strips a configured app base path', () => {
    configureAppBasePath('/admin');

    expect(getConfiguredAppBasePath()).toBe('/admin');
    expect(prefixAppBasePath('/bookings/1')).toBe('/admin/bookings/1');
    expect(prefixAppBasePath('/admin/bookings/1')).toBe('/admin/bookings/1');
    expect(stripAppBasePath('/admin/bookings/1')).toBe('/bookings/1');
    expect(stripAppBasePath('/admin')).toBe('/');
  });

  it('reads the current app pathname without the configured app base path', () => {
    configureAppBasePath('/admin');
    window.history.replaceState({}, '', '/admin/bookings/1?tab=workflow');

    expect(getCurrentAppPathname()).toBe('/bookings/1');
  });

  it('reads a sanitized returnTo from search params', () => {
    expect(getSanitizedReturnTo(new URLSearchParams('returnTo=%2Fbookings%2F1'))).toBe('/bookings/1');
    expect(getSanitizedReturnTo(new URLSearchParams('returnTo=%2F%2Fevil.example'))).toBeNull();
    expect(getSanitizedReturnTo(new URLSearchParams('travelDate=2026-03-13'))).toBeNull();
  });

  it('reads scoped location search values into default query state', () => {
    const values = getLocationSearchValues(
      { departureCode: '', arrivalCode: '', travelDate: '' },
      {
        prefix: 'flightAvailability',
        searchParams: new URLSearchParams('flightAvailability.departureCode=HND&flightAvailability.travelDate=2026-03-14&other=value'),
      },
    );
    expect(values).toEqual({
      departureCode: 'HND',
      arrivalCode: '',
      travelDate: '2026-03-14',
    });
  });

  it('replaces scoped location search values while preserving unrelated params', () => {
    window.history.replaceState({}, '', '/availability?returnTo=%2Fdashboard&flightAvailability.departureCode=HND');

    replaceLocationSearchValues(
      {
        departureCode: 'ITM',
        arrivalCode: '',
        travelDate: '2026-03-14',
      },
      {
        prefix: 'flightAvailability',
        keys: ['departureCode', 'arrivalCode', 'travelDate'],
      },
    );

    expect(window.location.pathname).toBe('/availability');
    expect(window.location.search).toBe('?returnTo=%2Fdashboard&flightAvailability.departureCode=ITM&flightAvailability.travelDate=2026-03-14');
  });

  it('shifts date-like query input values while preserving the original separator', () => {
    expect(shiftDateInputValue('2026-03-14', 1)).toBe('2026-03-15');
    expect(shiftDateInputValue('2026/03/14', -1)).toBe('2026/03/13');
    expect(shiftDateInputValue('not-a-date', 1)).toBe('not-a-date');
    expect(shiftDateInputValue('2026-02-30', 1)).toBe('2026-02-30');
  });
});
