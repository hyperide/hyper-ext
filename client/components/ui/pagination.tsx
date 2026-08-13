import { IconChevronLeft, IconChevronRight, IconDots } from '@tabler/icons-react';
import * as React from 'react';
import { type ButtonProps, buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const Pagination = ({ className, ...props }: React.ComponentProps<'nav'>) => (
  <nav
    data-uniq-id="61206779-714a-45d2-a509-376f916fd736"
    aria-label="pagination"
    className={cn('mx-auto flex w-full justify-center', className)}
    {...props}
  />
);
Pagination.displayName = 'Pagination';

const PaginationContent = React.forwardRef<HTMLUListElement, React.ComponentProps<'ul'>>(
  ({ className, ...props }, ref) => (
    <ul
      data-uniq-id="c9177efa-e55a-492d-a8c5-d8a45153a733"
      ref={ref}
      className={cn('flex flex-row items-center gap-1', className)}
      {...props}
    />
  ),
);
PaginationContent.displayName = 'PaginationContent';

const PaginationItem = React.forwardRef<HTMLLIElement, React.ComponentProps<'li'>>(({ className, ...props }, ref) => (
  <li data-uniq-id="6e6789bb-fd7d-4f84-857a-61bd760c10cc" ref={ref} className={cn('', className)} {...props} />
));
PaginationItem.displayName = 'PaginationItem';

type PaginationLinkProps = {
  isActive?: boolean;
} & Pick<ButtonProps, 'size'> &
  React.ComponentProps<'a'>;

const PaginationLink = ({ className, isActive, size = 'icon', ...props }: PaginationLinkProps) => (
  <a
    data-uniq-id="b17cda87-8eb6-4a87-aaeb-108eac5ee154"
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
  <PaginationLink
    data-uniq-id="83f85af8-541f-42c4-a215-28cb20948fc0"
    aria-label="Go to previous page"
    size="default"
    className={cn('gap-1 pl-2.5', className)}
    {...props}
  >
    <IconChevronLeft data-uniq-id="fc8ebc8d-24a9-44e6-a42d-28e07953fc65" className="h-4 w-4" />
    <span data-uniq-id="2a0503b6-f46d-48cf-b357-29ac8fdd7068">Previous</span>
  </PaginationLink>
);
PaginationPrevious.displayName = 'PaginationPrevious';

const PaginationNext = ({ className, ...props }: React.ComponentProps<typeof PaginationLink>) => (
  <PaginationLink
    data-uniq-id="86a0ec92-1f75-4bc9-8db0-fae953eb679a"
    aria-label="Go to next page"
    size="default"
    className={cn('gap-1 pr-2.5', className)}
    {...props}
  >
    <span data-uniq-id="15bb3cac-7cf0-41ca-9c7c-9898d79255fc">Next</span>
    <IconChevronRight data-uniq-id="d9d7d3cc-fe50-4ef1-8056-ae9866bf5ed6" className="h-4 w-4" />
  </PaginationLink>
);
PaginationNext.displayName = 'PaginationNext';

const PaginationEllipsis = ({ className, ...props }: React.ComponentProps<'span'>) => (
  <span
    data-uniq-id="e3c99f0a-e27f-4c88-b7eb-d98a8f18c3e2"
    aria-hidden
    className={cn('flex h-9 w-9 items-center justify-center', className)}
    {...props}
  >
    <IconDots data-uniq-id="24e50930-d0ca-4f1d-bbdb-e0ee5684ad86" className="h-4 w-4" />
    <span data-uniq-id="567d104f-599a-43e9-9807-542ef4e18a4b" className="sr-only">
      More pages
    </span>
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
    const range = [];
    const rangeWithDots = [];
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
    <MemoryRouter data-uniq-id="94e366e9-c21a-45dd-8e16-3e8754c09bc4">
      <Routes data-uniq-id="c473c5b5-b6c0-4459-8959-4c8c8fad0d13">
        <Route
          data-uniq-id="0e8d9f0e-7076-43c7-a374-95397762b3a0"
          path="/"
          element={
            <Pagination data-uniq-id="9caf2d03-62ad-4d6e-a350-1f7f1ef47b7b">
              <PaginationContent data-uniq-id="d8f3029a-f472-48e0-b19d-7d04d216588f">
                <PaginationItem data-uniq-id="caf1aa7f-39a3-4953-9198-570665df51a3">
                  <PaginationPrevious
                    data-uniq-id="e6ba4cc9-dd63-40b0-b8c7-0a5e65d29f34"
                    href={currentPage > 1 ? `?page=${currentPage - 1}` : '#'}
                  />
                </PaginationItem>
                {visiblePages.map((page, index) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: shadcn generated component, pages mix numbers and "..." strings
                  <PaginationItem data-uniq-id="07daa8de-8482-4b11-9375-459034e8e018" key={index}>
                    {page === '...' ? (
                      <PaginationEllipsis data-uniq-id="e245b18b-8273-43cc-b1fd-525fd29a9f0d" />
                    ) : (
                      <PaginationLink
                        data-uniq-id="341ec684-d6c2-4ed9-b9aa-f2ba4991ce65"
                        href={`?page=${page}`}
                        isActive={page === currentPage}
                      >
                        {page}
                      </PaginationLink>
                    )}
                  </PaginationItem>
                ))}
                <PaginationItem data-uniq-id="f7c58824-b8b3-49c3-bfe1-bc80832a2ad7">
                  <PaginationNext
                    data-uniq-id="4e843e79-3517-4cd5-aee1-6a1e51123797"
                    href={currentPage < totalPages ? `?page=${currentPage + 1}` : '#'}
                  />
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
