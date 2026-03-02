import type { ReactNode } from 'react';

export function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function highlightSearch(text: string, query: string): ReactNode {
  if (!query) return text;
  // nosemgrep: detect-non-literal-regexp -- query is sanitized via escapeRegExp above
  const regex = new RegExp(`(${escapeRegExp(query)})`, 'gi');
  const parts = text.split(regex);
  if (parts.length === 1) return text;
  const lower = query.toLowerCase();
  return parts.map((part, i) =>
    part.toLowerCase().includes(lower) ? (
      // biome-ignore lint/suspicious/noArrayIndexKey: stable split order from regex, no reordering
      <mark key={i} className="bg-yellow-500/30 dark:bg-yellow-400/20 text-inherit rounded-sm">
        {part}
      </mark>
    ) : (
      part
    ),
  );
}
