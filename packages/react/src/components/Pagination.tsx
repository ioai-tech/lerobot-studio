import * as React from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import {
  Button,
  cn,
  Pagination as PaginationNav,
  PaginationContent,
  PaginationItem,
} from '@ioai/lerobot-studio-ui';

const DEFAULT_ROWS_PER_PAGE_OPTIONS = [5, 10, 25, 50];

export interface PaginationProps {
  count: number;
  page: number;
  onPageChange: (event: unknown, newPage: number) => void;
  rowsPerPage: number;
  onRowsPerPageChange: (event: React.ChangeEvent<HTMLSelectElement>) => void;
  rowsPerPageOptions?: number[];
  className?: string;
}

/**
 * Domain table pagination composed from official shadcn pagination primitives.
 */
export function Pagination({
  count,
  page,
  onPageChange,
  rowsPerPage,
  onRowsPerPageChange,
  rowsPerPageOptions = DEFAULT_ROWS_PER_PAGE_OPTIONS,
  className,
}: PaginationProps) {
  const { t } = useTranslation();
  const totalPages = Math.max(0, Math.ceil(count / rowsPerPage));
  const from = count === 0 ? 0 : page * rowsPerPage + 1;
  const to = count === 0 ? 0 : Math.min((page + 1) * rowsPerPage, count);

  const labelRowsPerPage = t('pagination.rowsPerPage');
  const rangeText = count >= 0 ? t('pagination.range', { from, to, count }) : '';

  const handlePrevious = () => {
    if (page > 0) onPageChange(null, page - 1);
  };
  const handleNext = () => {
    if (page < totalPages - 1) onPageChange(null, page + 1);
  };

  return (
    <div
      className={cn(
        'flex flex-wrap items-center justify-between gap-4 px-2 py-1 text-sm text-muted-foreground',
        className,
      )}
    >
      <div className="flex items-center gap-2">
        <label htmlFor="table-pagination-rows" className="whitespace-nowrap">
          {labelRowsPerPage}
        </label>
        <select
          id="table-pagination-rows"
          value={rowsPerPage}
          onChange={onRowsPerPageChange}
          className={cn(
            'h-8 rounded-lg border border-input bg-transparent px-2.5 py-1 text-sm transition-colors',
            'focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none',
            'disabled:cursor-not-allowed disabled:opacity-50',
          )}
          aria-label={labelRowsPerPage}
        >
          {rowsPerPageOptions.map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </select>
      </div>
      <div className="flex items-center gap-2">
        <span className="whitespace-nowrap">{rangeText}</span>
        <PaginationNav>
          <PaginationContent>
            <PaginationItem>
              <Button
                variant="outline"
                size="sm"
                aria-label={t('pagination.prevAriaLabel')}
                onClick={handlePrevious}
                disabled={page <= 0}
                className="gap-1"
              >
                <ChevronLeft className="size-4" />
                <span className="hidden sm:inline">{t('pagination.previous')}</span>
              </Button>
            </PaginationItem>
            <PaginationItem>
              <Button
                variant="outline"
                size="sm"
                aria-label={t('pagination.nextAriaLabel')}
                onClick={handleNext}
                disabled={page >= totalPages - 1 || totalPages === 0}
                className="gap-1"
              >
                <span className="hidden sm:inline">{t('pagination.next')}</span>
                <ChevronRight className="size-4" />
              </Button>
            </PaginationItem>
          </PaginationContent>
        </PaginationNav>
      </div>
    </div>
  );
}
