import { SELECTORS } from '@/content/selectors';
import type { PaginationState } from '@/types/job';
import { absoluteUrl, attrOf, queryAll, queryFirst, textOf } from '@/utils/dom';
import { getCurrentPageNumberFromUrl } from '@/content/results-extractor';

function parsePageNumber(text: string): number | null {
  const match = text.match(/\d+/);
  if (!match) return null;
  const n = Number.parseInt(match[0], 10);
  return Number.isFinite(n) ? n : null;
}

function isDisabled(el: Element | null): boolean {
  if (!el) return true;
  if (el.hasAttribute('disabled')) return true;
  if (attrOf(el, 'aria-disabled') === 'true') return true;
  if (el.classList.contains('disabled')) return true;
  if (el instanceof HTMLButtonElement && el.disabled) return true;
  return false;
}

function pageNumberFromHref(href: string): number | null {
  try {
    const url = new URL(href, location.href);
    const pathMatch = url.pathname.match(/\/jobs-search\/(\d+)\/?/i);
    if (pathMatch?.[1]) return Number.parseInt(pathMatch[1], 10);
    const page = url.searchParams.get('page');
    if (page) return Number.parseInt(page, 10);
  } catch {
    // ignore
  }
  return null;
}

export function detectPagination(doc: Document = document): PaginationState {
  const config = SELECTORS.pagination[0];
  const currentFromDom = queryFirst(doc, config.activePage as unknown as string[]);
  const currentPage =
    parsePageNumber(textOf(currentFromDom)) ??
    pageNumberFromHref(location.href) ??
    getCurrentPageNumberFromUrl(location.href);

  const nextEl = queryFirst(doc, config.next as unknown as string[]);
  let nextHref = nextEl ? absoluteUrl(attrOf(nextEl, 'href')) : null;
  let hasNext = Boolean(nextEl && !isDisabled(nextEl) && nextHref);

  if (currentPage != null) {
    const pageLinks = queryAll(doc, config.pageLinks as unknown as string[]);
    for (const link of pageLinks) {
      const label = attrOf(link, 'aria-label') || textOf(link);
      const pageNum =
        parsePageNumber(label.replace(/^Page:\s*/i, '')) ??
        pageNumberFromHref(attrOf(link, 'href'));
      if (pageNum === currentPage + 1) {
        const href = absoluteUrl(attrOf(link, 'href'));
        if (href) {
          nextHref = href;
          hasNext = !isDisabled(link);
          break;
        }
      }
    }
  }

  // If a Next control exists with an href, treat it as available even when
  // aria-disabled is missing/inconsistent across ZipRecruiter builds.
  if (!hasNext && nextEl) {
    const href = absoluteUrl(attrOf(nextEl, 'href'));
    if (href && !isDisabled(nextEl)) {
      nextHref = href;
      hasNext = true;
    }
  }

  // Path-style fallback: /jobs-search/{n+1}?... when Next is present via numbered links only
  if (!hasNext && currentPage != null && nextHref) {
    hasNext = true;
  }

  const isFinalPage = !hasNext;

  return {
    currentPage,
    hasNext,
    nextPage: hasNext && currentPage != null ? currentPage + 1 : hasNext ? 1 : null,
    isFinalPage,
    nextHref: hasNext ? nextHref : null,
  };
}

export async function goToNextPage(): Promise<{
  success: boolean;
  pagination: PaginationState;
  error?: string;
}> {
  const pagination = detectPagination();
  if (!pagination.hasNext) {
    return { success: false, pagination, error: 'No next page control available.' };
  }

  const config = SELECTORS.pagination[0];
  const nextEl = queryFirst(document, config.next as unknown as string[]) as HTMLElement | null;

  if (nextEl && !isDisabled(nextEl)) {
    nextEl.click();
    return { success: true, pagination };
  }

  if (pagination.currentPage != null) {
    const pageLinks = queryAll(document, config.pageLinks as unknown as string[]);
    for (const link of pageLinks) {
      const label = attrOf(link, 'aria-label') || textOf(link);
      const pageNum =
        parsePageNumber(label.replace(/^Page:\s*/i, '')) ??
        pageNumberFromHref(attrOf(link, 'href'));
      if (pageNum === pagination.currentPage! + 1) {
        (link as HTMLElement).click();
        return { success: true, pagination };
      }
    }
  }

  if (pagination.nextHref) {
    location.assign(pagination.nextHref);
    return { success: true, pagination };
  }

  return {
    success: false,
    pagination,
    error: 'Unable to activate next page control.',
  };
}

export function detectLoadMore(): HTMLElement | null {
  const candidates = queryAll(document, [
    'button[aria-label*="Load more" i]',
    'button[data-testid="load-more"]',
    'button',
  ]);
  for (const el of candidates) {
    if (/load more|show more/i.test(textOf(el))) return el as HTMLElement;
  }
  return null;
}

export async function clickLoadMoreIfPresent(): Promise<boolean> {
  const button = detectLoadMore();
  if (!button || isDisabled(button)) return false;
  button.click();
  return true;
}
