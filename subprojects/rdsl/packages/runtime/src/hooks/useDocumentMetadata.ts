import React from 'react';
import { prefixAppBasePath } from './navigation.js';

export interface DocumentMetadata {
  title?: string | null;
  defaultTitle?: string | null;
  titleTemplate?: string | null;
  description?: string | null;
  canonicalPath?: string | null;
  image?: string | null;
  favicon?: string | null;
  noIndex?: boolean;
  siteName?: string | null;
}

export function useDocumentMetadata(metadata: DocumentMetadata): void {
  React.useEffect(() => {
    if (typeof document === 'undefined') {
      return;
    }

    const resolvedTitle = applyTitleTemplate(metadata.title, metadata.defaultTitle ?? null, metadata.titleTemplate ?? null);
    if (resolvedTitle) {
      document.title = resolvedTitle;
    }

    setNamedMeta('description', metadata.description ?? null);
    setNamedMeta('robots', metadata.noIndex ? 'noindex,nofollow' : null);
    setPropertyMeta('og:title', resolvedTitle);
    setPropertyMeta('og:description', metadata.description ?? null);
    setPropertyMeta('og:image', toAbsoluteUrl(metadata.image ?? null));
    setPropertyMeta('og:site_name', metadata.siteName ?? null);
    setCanonicalHref(metadata.canonicalPath ?? null);
    setFaviconHref(metadata.favicon ?? null);
  }, [
    metadata.title,
    metadata.defaultTitle,
    metadata.titleTemplate,
    metadata.description,
    metadata.canonicalPath,
    metadata.image,
    metadata.favicon,
    metadata.noIndex,
    metadata.siteName,
  ]);
}

function applyTitleTemplate(
  title: string | null | undefined,
  defaultTitle: string | null,
  titleTemplate: string | null,
): string | null {
  const effectiveTitle = title && title.trim().length > 0 ? title : defaultTitle;
  if (!effectiveTitle) {
    return null;
  }
  if (!titleTemplate || !titleTemplate.includes('{title}')) {
    return effectiveTitle;
  }
  return titleTemplate.replace(/\{title\}/g, effectiveTitle);
}

function setNamedMeta(name: string, content: string | null): void {
  const selector = `meta[name="${name}"]`;
  let element = document.head.querySelector<HTMLMetaElement>(selector);
  if (!content) {
    element?.remove();
    return;
  }
  if (!element) {
    element = document.createElement('meta');
    element.setAttribute('name', name);
    document.head.appendChild(element);
  }
  element.setAttribute('content', content);
}

function setPropertyMeta(name: string, content: string | null): void {
  const selector = `meta[property="${name}"]`;
  let element = document.head.querySelector<HTMLMetaElement>(selector);
  if (!content) {
    element?.remove();
    return;
  }
  if (!element) {
    element = document.createElement('meta');
    element.setAttribute('property', name);
    document.head.appendChild(element);
  }
  element.setAttribute('content', content);
}

function setCanonicalHref(path: string | null): void {
  const selector = 'link[rel="canonical"]';
  let element = document.head.querySelector<HTMLLinkElement>(selector);
  if (!path) {
    element?.remove();
    return;
  }
  if (!element) {
    element = document.createElement('link');
    element.setAttribute('rel', 'canonical');
    document.head.appendChild(element);
  }
  element.setAttribute('href', toAbsoluteUrl(path) ?? path);
}

function setFaviconHref(path: string | null): void {
  const selector = 'link[rel="icon"]';
  let element = document.head.querySelector<HTMLLinkElement>(selector);
  if (!path) {
    element?.remove();
    return;
  }
  if (!element) {
    element = document.createElement('link');
    element.setAttribute('rel', 'icon');
    document.head.appendChild(element);
  }
  element.setAttribute('href', path);
}

function toAbsoluteUrl(path: string | null): string | null {
  if (!path || typeof window === 'undefined') {
    return path;
  }
  if (/^https?:\/\//.test(path)) {
    return path;
  }
  try {
    return new URL(path.startsWith('/') ? prefixAppBasePath(path) : path, window.location.origin).toString();
  } catch {
    return path;
  }
}
