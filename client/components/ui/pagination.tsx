import { IconChevronLeft, IconChevronRight, IconDots } from '@tabler/icons-react';
import * as React from 'react';
import { type ButtonProps, buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const Pagination = ({ className, ...props }: React.ComponentProps<'nav'>) => (
  <nav aria-label="pagination" className={cn('mx-auto flex w-full justify-center', className)} {...props} />
);
Pagination.displayName = 'Pagination';

const PaginationContent = React.forwardRef<HTMLUListElement, React.ComponentProps<'ul'>>(
  ({ className, ...props }, ref) => (
    <ul ref={ref} className={cn('flex flex-row items-center gap-1', className)} {...props} />
  ),
);
PaginationContent.displayName = 'PaginationContent';

const PaginationItem = React.forwardRef<HTMLLIElement, React.ComponentProps<'li'>>(({ className, ...props }, ref) => (
  <li ref={ref} className={cn('', className)} {...props} />
));
PaginationItem.displayName = 'PaginationItem';

type PaginationLinkProps = {
  isActive?: boolean;
} & Pick<ButtonProps, 'size'> &
  React.ComponentProps<'a'>;

const PaginationLink = ({ className, isActive, size = 'icon', ...props }: PaginationLinkProps) => (
  <a
    aria-current={isActive ? 'page' : undefined}
    className={cn(
      buttonVariants({
        variant: isActive ? 'outline' : 'ghost',
        size,
      }),
      className,
    )}
    {...props}
  />
);
PaginationLink.displayName = 'PaginationLink';

const PaginationPrevious = ({ className, ...props }: React.ComponentProps<typeof PaginationLink>) => (
  <PaginationLink aria-label="Go to previous page" size="default" className={cn('gap-1 pl-2.5', className)} {...props}>
    <IconChevronLeft className="h-4 w-4" />
    <span>Previous</span>
  </PaginationLink>
);
PaginationPrevious.displayName = 'PaginationPrevious';

const PaginationNext = ({ className, ...props }: React.ComponentProps<typeof PaginationLink>) => (
  <PaginationLink aria-label="Go to next page" size="default" className={cn('gap-1 pr-2.5', className)} {...props}>
    <span>Next</span>
    <IconChevronRight className="h-4 w-4" />
  </PaginationLink>
);
PaginationNext.displayName = 'PaginationNext';

const PaginationEllipsis = ({ className, ...props }: React.ComponentProps<'span'>) => (
  <span aria-hidden className={cn('flex h-9 w-9 items-center justify-center', className)} {...props}>
    <IconDots className="h-4 w-4" />
    <span className="sr-only">More pages</span>
  </span>
);
PaginationEllipsis.displayName = 'PaginationEllipsis';

export {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
};

export const SampleDefault = ({ currentPage = 8, totalPages = 12 }: { currentPage?: number; totalPages?: number }) => {
  // Helper to generate pagination links
  const getVisiblePages = (current: number, total: number) => {
    const delta = 1;
    const range: number[] = [];
    const rangeWithDots: (number | string)[] = [];
    let l: number | undefined;

    for (let i = 1; i <= total; i++) {
      if (i === 1 || i === total || (i >= current - delta && i <= current + delta)) {
        range.push(i);
      }
    }

    range.forEach((i) => {
      if (l) {
        if (i - l === 2) {
          rangeWithDots.push(l + 1);
        } else if (i - l !== 1) {
          rangeWithDots.push('...');
        }
      }
      rangeWithDots.push(i);
      l = i;
    });

    return rangeWithDots;
  };

  const visiblePages = getVisiblePages(currentPage, totalPages);

  return (
    <MemoryRouter>
      <Routes>
        <Route
          path="/"
          element={
            <Pagination>
              <PaginationContent>
                <PaginationItem>
                  <PaginationPrevious href={currentPage > 1 ? `?page=${currentPage - 1}` : '#'} />
                </PaginationItem>
                {visiblePages.map((page, index) => (
                  // eslint-disable-next-line react/no-array-index-key -- shadcn generated component, pages mix numbers and "..." strings
                  <PaginationItem key={index}>
                    {page === '...' ? (
                      <PaginationEllipsis />
                    ) : (
                      <PaginationLink href={`?page=${page}`} isActive={page === currentPage}>
                        {page}
                      </PaginationLink>
                    )}
                  </PaginationItem>
                ))}
                <PaginationItem>
                  <PaginationNext href={currentPage < totalPages ? `?page=${currentPage + 1}` : '#'} />
                </PaginationItem>
              </PaginationContent>
            </Pagination>
          }
        />
      </Routes>
    </MemoryRouter>
  );
};

import { MemoryRouter, Route, Routes } from 'react-router-dom';
