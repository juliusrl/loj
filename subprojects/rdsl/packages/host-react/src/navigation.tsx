import React from 'react';

export interface ClientNavigationCandidate {
  href: string;
  target?: string | null;
  download?: boolean;
  currentUrl: string;
}

export function resolveClientNavigationLocation(candidate: ClientNavigationCandidate): string | null {
  if (!candidate.href) return null;
  if (candidate.target && candidate.target !== '_self') return null;
  if (candidate.download) return null;
  if (candidate.href.startsWith('#') || candidate.href.startsWith('mailto:') || candidate.href.startsWith('tel:')) {
    return null;
  }

  const nextUrl = new URL(candidate.href, candidate.currentUrl);
  const currentUrl = new URL(candidate.currentUrl);
  if (nextUrl.origin !== currentUrl.origin) return null;

  const nextLocation = `${nextUrl.pathname}${nextUrl.search}${nextUrl.hash}`;
  const currentLocation = `${currentUrl.pathname}${currentUrl.search}${currentUrl.hash}`;
  return nextLocation === currentLocation ? null : nextLocation;
}

function shouldHandleAnchorClick(event: MouseEvent): HTMLAnchorElement | null {
  if (event.defaultPrevented || event.button !== 0) return null;
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return null;
  if (!(event.target instanceof Element)) return null;
  const anchor = event.target.closest('a[href]');
  if (!(anchor instanceof HTMLAnchorElement)) return null;
  const nextLocation = resolveClientNavigationLocation({
    href: anchor.getAttribute('href') ?? '',
    target: anchor.target,
    download: anchor.hasAttribute('download'),
    currentUrl: window.location.href,
  });
  return nextLocation ? anchor : null;
}

export function BrowserNavigationBridge({ children }: { children?: React.ReactNode }) {
  React.useEffect(() => {
    const handleClick = (event: MouseEvent) => {
      const anchor = shouldHandleAnchorClick(event);
      if (!anchor) return;

      const nextLocation = resolveClientNavigationLocation({
        href: anchor.href,
        target: anchor.target,
        download: anchor.hasAttribute('download'),
        currentUrl: window.location.href,
      });
      if (!nextLocation) return;

      event.preventDefault();
      window.history.pushState({}, '', nextLocation);
      window.dispatchEvent(new PopStateEvent('popstate'));
    };

    document.addEventListener('click', handleClick);
    return () => {
      document.removeEventListener('click', handleClick);
    };
  }, []);

  return <>{children}</>;
}
