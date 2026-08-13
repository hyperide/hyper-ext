/**
 * @file Design tokens panel shown in the Inspector when no element is selected.
 *
 * Renders CSS custom properties grouped by category (colors, typography, spacing,
 * shadows, other). Color tokens include a small swatch square. Categories without
 * tokens are omitted; when no tokens exist at all an empty state is shown.
 */

import type { DesignToken, DesignTokenCategory } from './types';

interface DesignTokensPanelProps {
  tokens: DesignToken[];
}

const CATEGORY_LABELS: Record<DesignTokenCategory, string> = {
  colors: 'Colors',
  typography: 'Typography',
  spacing: 'Spacing',
  shadows: 'Shadows',
  other: 'Other',
};

const CATEGORY_ORDER: DesignTokenCategory[] = ['colors', 'typography', 'spacing', 'shadows', 'other'];

function isColorValue(value: string): boolean {
  const v = value.trim();
  return /^#[0-9a-f]{3,8}$/i.test(v) || /^rgb|^hsl|^oklch|^lch|^lab|^color\(/i.test(v);
}

function groupByCategory(tokens: DesignToken[]): Map<DesignTokenCategory, DesignToken[]> {
  const map = new Map<DesignTokenCategory, DesignToken[]>();
  for (const token of tokens) {
    const list = map.get(token.category) ?? [];
    list.push(token);
    map.set(token.category, list);
  }
  return map;
}

function ColorSwatch({ value }: { value: string }) {
  return (
    <span
      className="inline-block w-3 h-3 rounded-sm border border-border/50 shrink-0"
      style={{ background: value }}
      aria-hidden="true"
    />
  );
}

function TokenRow({ token }: { token: DesignToken }) {
  const showSwatch = token.category === 'colors' && isColorValue(token.value);
  return (
    <div className="flex items-center gap-1.5 py-0.5 min-w-0">
      {showSwatch ? <ColorSwatch value={token.value} /> : <span className="w-3 h-3 shrink-0" />}
      <span className="text-[10px] text-foreground font-mono truncate min-w-0 flex-1" title={token.name}>
        {token.name}
      </span>
      <span
        className="text-[10px] text-muted-foreground font-mono truncate shrink-0 max-w-[45%]"
        title={token.value}
      >
        {token.value}
      </span>
    </div>
  );
}

function CategorySection({ category, tokens }: { category: DesignTokenCategory; tokens: DesignToken[] }) {
  return (
    <div>
      <p className="px-4 py-1 text-[9px] uppercase tracking-wider text-muted-foreground/70 font-medium border-b border-border/30">
        {CATEGORY_LABELS[category]}
      </p>
      <div className="px-4 py-1">
        {tokens.map((token) => (
          <TokenRow key={token.name} token={token} />
        ))}
      </div>
    </div>
  );
}

export function DesignTokensPanel({ tokens }: DesignTokensPanelProps) {
  if (tokens.length === 0) {
    return (
      <div className="px-4 py-4 text-center">
        <p className="text-xs text-muted-foreground/60">No design tokens found</p>
      </div>
    );
  }

  const grouped = groupByCategory(tokens);
  const presentCategories = CATEGORY_ORDER.filter((c) => (grouped.get(c)?.length ?? 0) > 0);

  return (
    <div className="border-t border-border/30 mt-2">
      <p className="px-4 pt-3 pb-1 text-[9px] uppercase tracking-wider text-muted-foreground/50 font-medium">
        Design Tokens
      </p>
      {presentCategories.map((category) => (
        <CategorySection key={category} category={category} tokens={grouped.get(category)!} />
      ))}
    </div>
  );
}
