import React from 'react';

export interface PaginationProps {
  current: number;
  total: number;
  onChange: (page: number) => void;
}

function clampPage(page: number, total: number): number {
  return Math.min(Math.max(page, 1), Math.max(total, 1));
}

export function Pagination({ current, total, onChange }: PaginationProps) {
  const totalPages = Math.max(total, 1);
  const currentPage = clampPage(current, totalPages);

  return (
    <nav className="rdsl-pagination" aria-label="Pagination">
      <button type="button" disabled={currentPage <= 1} onClick={() => onChange(currentPage - 1)}>
        Previous
      </button>
      {Array.from({ length: totalPages }, (_, index) => index + 1).map((page) => (
        <button
          key={page}
          type="button"
          aria-current={page === currentPage ? 'page' : undefined}
          disabled={page === currentPage}
          onClick={() => onChange(page)}
        >
          {page}
        </button>
      ))}
      <button type="button" disabled={currentPage >= totalPages} onClick={() => onChange(currentPage + 1)}>
        Next
      </button>
    </nav>
  );
}
