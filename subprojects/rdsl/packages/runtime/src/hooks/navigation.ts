let configuredAppBasePath = '/';

export function normalizeAppBasePath(value: string | null | undefined): string {
  if (!value) {
    return '/';
  }
  const trimmed = value.trim();
  if (!trimmed || trimmed === '/') {
    return '/';
  }
  const prefixed = trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
  return prefixed.endsWith('/') ? prefixed.slice(0, -1) || '/' : prefixed;
}

export function configureAppBasePath(value: string | null | undefined): void {
  configuredAppBasePath = normalizeAppBasePath(value);
}

export function getConfiguredAppBasePath(): string {
  return configuredAppBasePath;
}

export function prefixAppBasePath(path: string): string {
  if (!path.startsWith('/')) {
    return path;
  }
  const basePath = getConfiguredAppBasePath();
  if (basePath === '/') {
    return path;
  }
  if (path === basePath || path.startsWith(`${basePath}/`)) {
    return path;
  }
  if (path === '/') {
    return basePath;
  }
  return `${basePath}${path}`;
}

export function stripAppBasePath(pathname: string): string {
  const normalizedPathname = pathname && pathname.startsWith('/') ? pathname : `/${pathname || ''}`;
  const basePath = getConfiguredAppBasePath();
  if (basePath === '/') {
    return normalizedPathname === '' ? '/' : normalizedPathname;
  }
  if (normalizedPathname === basePath) {
    return '/';
  }
  if (normalizedPathname.startsWith(`${basePath}/`)) {
    return normalizedPathname.slice(basePath.length) || '/';
  }
  return normalizedPathname === '' ? '/' : normalizedPathname;
}

export function getCurrentAppPathname(): string {
  if (typeof window === 'undefined') return '/';
  return stripAppBasePath(window.location.pathname);
}

export function getCurrentAppHref(): string {
  if (typeof window === 'undefined') return '/';
  return `${window.location.pathname}${window.location.search}`;
}

export function getLocationSearchParams(): URLSearchParams | null {
  if (typeof window === 'undefined') return null;
  return new URLSearchParams(window.location.search);
}

export function shiftDateInputValue(value: string, days: number): string {
  const trimmed = String(value ?? '').trim();
  const match = trimmed.match(/^(\d{4})([-/])(\d{2})\2(\d{2})$/);
  if (!match) {
    return trimmed;
  }
  const [, yearText, separator, monthText, dayText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    return trimmed;
  }
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    Number.isNaN(date.getTime())
    || date.getUTCFullYear() !== year
    || date.getUTCMonth() !== month - 1
    || date.getUTCDate() !== day
  ) {
    return trimmed;
  }
  date.setUTCDate(date.getUTCDate() + days);
  const nextYear = String(date.getUTCFullYear()).padStart(4, '0');
  const nextMonth = String(date.getUTCMonth() + 1).padStart(2, '0');
  const nextDay = String(date.getUTCDate()).padStart(2, '0');
  return `${nextYear}${separator}${nextMonth}${separator}${nextDay}`;
}

function scopedSearchParamKey(prefix: string | undefined, key: string): string {
  return prefix ? `${prefix}.${key}` : key;
}

export function getLocationSearchValues<T extends Record<string, string>>(
  defaultValues: T,
  options: {
    prefix?: string;
    searchParams?: URLSearchParams | null;
  } = {},
): T {
  const params = options.searchParams ?? getLocationSearchParams();
  const nextValues = { ...defaultValues };
  for (const key of Object.keys(defaultValues)) {
    const value = params?.get(scopedSearchParamKey(options.prefix, key));
    if (value !== null && value !== undefined) {
      nextValues[key as keyof T] = value as T[keyof T];
    }
  }
  return nextValues;
}

export function replaceLocationSearchValues(
  values: Record<string, string>,
  options: {
    prefix?: string;
    keys?: readonly string[];
  } = {},
): void {
  if (typeof window === 'undefined') {
    return;
  }

  const keys = options.keys ?? Object.keys(values);
  const params = new URLSearchParams(window.location.search);
  for (const key of keys) {
    const value = String(values[key] ?? '');
    const scopedKey = scopedSearchParamKey(options.prefix, key);
    if (value.trim() === '') {
      params.delete(scopedKey);
    } else {
      params.set(scopedKey, value);
    }
  }

  const nextSearch = params.toString();
  const nextHref = `${window.location.pathname}${nextSearch ? `?${nextSearch}` : ''}${window.location.hash}`;
  const currentHref = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  if (nextHref !== currentHref) {
    window.history.replaceState(window.history.state, '', nextHref);
  }
}

export function sanitizeAppLocalHref(candidate: string | null | undefined): string | null {
  if (!candidate || !candidate.startsWith('/') || candidate.startsWith('//')) return null;
  return candidate;
}

export function getSanitizedReturnTo(searchParams?: URLSearchParams | null): string | null {
  const params = searchParams ?? getLocationSearchParams();
  return sanitizeAppLocalHref(params?.get('returnTo'));
}
