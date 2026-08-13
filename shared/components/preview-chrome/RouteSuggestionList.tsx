/**
 * @file Suggestions popover for the app-preview address bar.
 *
 * Accessed via: AddressBar (this directory) — rendered only when there is >=1 suggestion AND
 *   the input is focused/open. Never rendered for an empty list (no empty/placeholder dropdown).
 * Styling: portable `--overlay-*` CSS vars (same system as shared overlays) so it renders
 *   identically in the VS Code webview and the SaaS canvas without Tailwind divergence.
 */

import type { CSSProperties } from 'react';
import type { RouteSuggestionItem } from './types';

interface RouteSuggestionListProps {
  suggestions: RouteSuggestionItem[];
  /** Index of the keyboard-highlighted row, or -1 when the typed value is the active line. */
  activeIndex: number;
  onPick: (path: string) => void;
  onHover: (index: number) => void;
  /** Stable id so the input's aria-activedescendant can point at the active row. */
  listboxId: string;
}

const listboxStyle: CSSProperties = {
  position: 'absolute',
  top: 'calc(100% + 4px)',
  left: 0,
  right: 0,
  margin: 0,
  padding: 4,
  listStyle: 'none',
  maxHeight: 240,
  overflowY: 'auto',
  background: 'var(--overlay-bg)',
  border: '1px solid var(--overlay-border)',
  borderRadius: 8,
  boxShadow: '0 8px 24px rgba(0, 0, 0, 0.28)',
  zIndex: 30,
  fontFamily: 'var(--overlay-font)',
};

function rowStyle(active: boolean): CSSProperties {
  return {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '6px 8px',
    borderRadius: 5,
    cursor: 'pointer',
    background: active ? 'var(--overlay-accent)' : 'transparent',
    color: active ? 'var(--overlay-accent-fg)' : 'var(--overlay-fg)',
  };
}

/** Source glyph encodes provenance: a filled dot = declared route, a hollow ring = scanned link. */
function sourceGlyph(source: RouteSuggestionItem['source'], active: boolean): CSSProperties {
  const declared = source === 'route-config' || source === 'file-route';
  const tint = active ? 'var(--overlay-accent-fg)' : 'var(--overlay-muted)';
  return {
    flex: '0 0 auto',
    width: 6,
    height: 6,
    borderRadius: '50%',
    background: declared ? tint : 'transparent',
    border: declared ? 'none' : `1px solid ${tint}`,
    opacity: active ? 1 : 0.7,
  };
}

const pathStyle: CSSProperties = {
  flex: 1,
  fontFamily: 'var(--overlay-font-mono)',
  fontSize: 12,
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
};

export function RouteSuggestionList({
  suggestions,
  activeIndex,
  onPick,
  onHover,
  listboxId,
}: RouteSuggestionListProps) {
  return (
    <ul id={listboxId} role="listbox" aria-label="Route suggestions" style={listboxStyle}>
      {suggestions.map((item, index) => {
        const active = index === activeIndex;
        return (
          <li
            key={item.path}
            id={`${listboxId}-opt-${index}`}
            role="option"
            aria-selected={active}
            style={rowStyle(active)}
            // onMouseDown (not onClick): fires before the input's blur, so picking a row
            // doesn't close the popover before the handler runs. preventDefault keeps focus.
            onMouseDown={(e) => {
              e.preventDefault();
              onPick(item.path);
            }}
            onMouseEnter={() => onHover(index)}
          >
            <span aria-hidden="true" style={sourceGlyph(item.source, active)} />
            <span style={pathStyle}>{item.path}</span>
          </li>
        );
      })}
    </ul>
  );
}
