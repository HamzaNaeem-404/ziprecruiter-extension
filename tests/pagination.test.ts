import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { detectPagination } from '@/content/pagination';

describe('pagination-state detection', () => {
  it('detects a final page with disabled next control', () => {
    const html = readFileSync(resolve(__dirname, 'fixtures/pagination-final.html'), 'utf8');
    const body = html.match(/<body[^>]*>([\s\S]*)<\/body>/i)?.[1] ?? html;
    document.body.innerHTML = body;

    const state = detectPagination();
    expect(state.currentPage).toBe(3);
    expect(state.hasNext).toBe(false);
    expect(state.isFinalPage).toBe(true);
  });

  it('detects next page from numbered links', () => {
    document.body.innerHTML = `
      <nav aria-label="pagination">
        <span aria-current="page">1</span>
        <a href="?page=2">2</a>
        <a href="?page=3">3</a>
        <a aria-label="Next Page" href="?page=2">Next</a>
      </nav>
    `;
    const state = detectPagination();
    expect(state.currentPage).toBe(1);
    expect(state.hasNext).toBe(true);
    expect(state.nextPage).toBe(2);
    expect(state.nextHref).toContain('page=2');
  });
});
