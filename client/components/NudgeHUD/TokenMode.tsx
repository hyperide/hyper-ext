/**
 * @file TokenMode — token-scale pagination, special values, and color swatches
 *
 * Accessed via: Rendered by NudgeHUD when mode === 'token'
 * Assumptions: adapter is never 'none' — NudgeHUD only renders TokenMode for tailwind/tamagui
 * Layout: ⇅ | pagination | ⇧ specials (if any) | t raw-value
 */
import type { AdapterName, TokenEntry } from '@lib/tokens/token-scales';
import {
  COLOR_PROPERTIES,
  findNearestToken,
  getAdjacentTokens,
  getNeighboringFamilies,
  getSpecialValues,
  getTokenScale,
  TAILWIND_COLOR_FAMILIES,
  TAMAGUI_COLOR_FAMILIES,
} from '@lib/tokens/token-scales';
import { IconArrowBigUp } from '@tabler/icons-react';
import cn from 'clsx';
import { useNudgeState } from '@/lib/nudge';
import type { NudgeAdapter } from './NudgeHUD';
import { Separator } from './NudgeHUD';

const SHORT_SCALE_MAX = 7;

interface TokenModeProps {
  adapter: NudgeAdapter;
}

export function TokenMode({ adapter }: TokenModeProps) {
  const activeProperty = useNudgeState((s) => s.activeProperty);
  const currentValue = useNudgeState((s) => s.currentValue);

  if (!activeProperty) return null;

  const adapterName = adapter as AdapterName;
  const isColor = COLOR_PROPERTIES.has(activeProperty);

  // For colors, we need to find the family first via a preliminary lookup
  let colorFamily: string | null = null;
  if (isColor) {
    const families = adapterName === 'tailwind' ? TAILWIND_COLOR_FAMILIES : TAMAGUI_COLOR_FAMILIES;

    for (const family of families) {
      const scale = getTokenScale(activeProperty, adapterName, { colorFamily: family });
      const match = findNearestToken(currentValue, scale);
      if (match) {
        colorFamily = family;
        break;
      }
    }
  }

  const scale = getTokenScale(activeProperty, adapterName, colorFamily ? { colorFamily } : undefined);
  const nearest = scale.length > 0 ? findNearestToken(currentValue, scale) : null;

  if (!nearest) {
    return (
      <div className="flex items-center gap-1.5">
        <RawValue value={currentValue} />
      </div>
    );
  }

  const adjacent = getAdjacentTokens(nearest.token, scale);
  const isShortScale = scale.length <= SHORT_SCALE_MAX;

  const specials = isColor ? [] : getSpecialValues(activeProperty, adapterName);
  const neighbors = isColor && colorFamily ? getNeighboringFamilies(colorFamily, adapterName) : null;
  const hasShiftSection = specials.length > 0 || (neighbors && (neighbors.prev || neighbors.next));

  return (
    <div className="flex items-center gap-1.5">
      {isShortScale ? (
        <FullScale scale={scale} currentToken={nearest.token} isColor={isColor} />
      ) : (
        <PaginatedScale current={nearest} adjacent={adjacent} isColor={isColor} />
      )}
      {hasShiftSection && (
        <>
          <Separator />
          <ShiftSection specials={specials} neighbors={neighbors} adapter={adapterName} />
        </>
      )}
      <Separator />
      <RawValue value={currentValue} />
    </div>
  );
}

/** Renders all tokens in a short scale (≤7 values) */
function FullScale({ scale, currentToken, isColor }: { scale: TokenEntry[]; currentToken: string; isColor: boolean }) {
  return (
    <div className="flex items-center gap-0.5">
      {scale.map((entry) => (
        <TokenPill key={entry.token} entry={entry} isCurrent={entry.token === currentToken} isColor={isColor} />
      ))}
    </div>
  );
}

/** Renders first ··· prev [CURRENT] next ··· last pagination */
function PaginatedScale({
  current,
  adjacent,
  isColor,
}: {
  current: TokenEntry;
  adjacent: ReturnType<typeof getAdjacentTokens>;
  isColor: boolean;
}) {
  // Show first/last only when current is not already at that edge
  const showFirst = adjacent.prev !== null && adjacent.prev.token !== adjacent.first.token;
  const showLast = adjacent.next !== null && adjacent.next.token !== adjacent.last.token;

  return (
    <div className="flex items-center gap-0.5">
      {showFirst && <TokenPill entry={adjacent.first} isCurrent={false} isColor={isColor} variant="edge" />}
      {showFirst && <Ellipsis />}
      {adjacent.prev && <TokenPill entry={adjacent.prev} isCurrent={false} isColor={isColor} />}
      <TokenPill entry={current} isCurrent isColor={isColor} />
      {adjacent.next && <TokenPill entry={adjacent.next} isCurrent={false} isColor={isColor} />}
      {showLast && <Ellipsis />}
      {showLast && <TokenPill entry={adjacent.last} isCurrent={false} isColor={isColor} variant="edge" />}
    </div>
  );
}

function TokenPill({
  entry,
  isCurrent,
  isColor,
  variant,
}: {
  entry: TokenEntry;
  isCurrent: boolean;
  isColor: boolean;
  variant?: 'edge';
}) {
  const label = extractDisplayLabel(entry.token, isColor);

  return (
    <span
      className={cn(
        'text-[10px] rounded inline-flex items-center gap-0.5',
        isCurrent
          ? 'bg-violet-600 text-white font-semibold px-1.5 py-0.5'
          : variant === 'edge'
            ? 'text-white/40'
            : 'bg-white/10 text-white/60 px-1 py-0.5',
      )}
    >
      {isColor && (
        <span
          data-testid="color-swatch"
          className="inline-block w-1.5 h-1.5 rounded-sm"
          style={{ backgroundColor: entry.value }}
        />
      )}
      {label}
    </span>
  );
}

/** Extract human-friendly label from a token: "rounded-none" → "none", "blue-500" → "500", "$blue5" → "5" */
function extractDisplayLabel(token: string, isColor: boolean): string {
  if (isColor) {
    // Color shade: "blue-500" → "500", "$blue5" → "5"
    const shadeMatch = token.match(/(\d+)$/);
    if (shadeMatch) return shadeMatch[1];
  }
  // Radius: "rounded-none" → "none", "rounded-full" → "full"
  if (token.startsWith('rounded-')) return token.slice(8);
  return token;
}

function Ellipsis() {
  return <span className="text-[10px] text-white/30">···</span>;
}

function ShiftSection({
  specials,
  neighbors,
  adapter,
}: {
  specials: string[];
  neighbors: { prev: string | null; next: string | null } | null;
  adapter: AdapterName;
}) {
  return (
    <div className="flex items-center gap-1">
      <span className="text-[10px] text-white/60">
        <IconArrowBigUp size={10} stroke={1.5} />
      </span>
      {specials.length > 0 && (
        <div className="flex items-center gap-0.5">
          {specials.map((val) => (
            <span key={val} className="text-[10px] bg-white/10 text-white/60 px-1 py-0.5 rounded">
              {val}
            </span>
          ))}
        </div>
      )}
      {neighbors && (
        <div className="flex items-center gap-0.5">
          {neighbors.prev && <FamilyPreview family={neighbors.prev} direction="up" adapter={adapter} />}
          {neighbors.next && <FamilyPreview family={neighbors.next} direction="down" adapter={adapter} />}
        </div>
      )}
    </div>
  );
}

function FamilyPreview({
  family,
  direction,
  adapter,
}: {
  family: string;
  direction: 'up' | 'down';
  adapter: AdapterName;
}) {
  const arrow = direction === 'up' ? '\u2191' : '\u2193';
  // Get a representative swatch from the family (middle shade)
  const scale = getTokenScale('backgroundColor', adapter, { colorFamily: family });
  const midEntry = scale[Math.floor(scale.length / 2)];

  return (
    <span className="text-[10px] text-white/60 inline-flex items-center gap-0.5">
      {arrow}
      {midEntry && (
        <span
          data-testid="color-swatch"
          className="inline-block w-1.5 h-1.5 rounded-sm"
          style={{ backgroundColor: midEntry.value }}
        />
      )}
      {family}
    </span>
  );
}

function RawValue({ value }: { value: string }) {
  return (
    <div className="flex items-center gap-1">
      <span className="text-[10px] text-white/60">t</span>
      <span className="text-[10px] text-white/60">{value}</span>
    </div>
  );
}
